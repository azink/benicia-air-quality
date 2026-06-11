const axios = require('axios');
const cron = require('node-cron');
const db = require('./db');

const BENICIA_LAT = 38.0499;
const BENICIA_LON = -122.1597;
const RADIUS_METERS = 15000;

// EPA PM2.5 breakpoints → AQI
function pm25ToAQI(pm25) {
  const bp = [
    [0,    12.0,  0,   50],
    [12.1, 35.4,  51,  100],
    [35.5, 55.4,  101, 150],
    [55.5, 150.4, 151, 200],
    [150.5,250.4, 201, 300],
    [250.5,350.4, 301, 400],
    [350.5,500.4, 401, 500],
  ];
  for (const [cLo, cHi, iLo, iHi] of bp) {
    if (pm25 >= cLo && pm25 <= cHi)
      return Math.round(((iHi - iLo) / (cHi - cLo)) * (pm25 - cLo) + iLo);
  }
  return 500;
}

const upsertSensor = db.prepare(`
  INSERT INTO sensors (sensor_id, name, source, latitude, longitude, last_seen)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(sensor_id) DO UPDATE SET last_seen = excluded.last_seen, name = excluded.name
`);

const insertReading = db.prepare(`
  INSERT INTO readings (sensor_id, timestamp, pm25, pm10, aqi, temperature, humidity, o3, no2, co)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

async function collectOpenAQ() {
  if (!process.env.OPENAQ_API_KEY) {
    console.warn('[OpenAQ] No API key — set OPENAQ_API_KEY in .env to enable');
    return;
  }

  const headers = { 'X-API-Key': process.env.OPENAQ_API_KEY };

  let locations;
  try {
    const res = await axios.get('https://api.openaq.org/v3/locations', {
      headers,
      params: {
        coordinates: `${BENICIA_LAT},${BENICIA_LON}`,
        radius: RADIUS_METERS,
        limit: 25,
      },
      timeout: 15000,
    });
    locations = res.data.results || [];
  } catch (err) {
    console.error('[OpenAQ] Failed to fetch locations:', err.message);
    return;
  }

  let collected = 0;
  for (const loc of locations) {
    const sensorId = `openaq_${loc.id}`;
    upsertSensor.run(
      sensorId,
      loc.name || `OpenAQ ${loc.id}`,
      'openaq',
      loc.coordinates?.latitude ?? null,
      loc.coordinates?.longitude ?? null,
      new Date().toISOString(),
    );

    try {
      const measRes = await axios.get(`https://api.openaq.org/v3/locations/${loc.id}/latest`, {
        headers,
        timeout: 10000,
      });
      const measurements = measRes.data.results || [];

      const r = { pm25: null, pm10: null, o3: null, no2: null, co: null, temperature: null, humidity: null };
      for (const m of measurements) {
        const p = (m.parameter?.name || '').toLowerCase();
        const v = m.value;
        if (p === 'pm25' || p === 'pm2.5') r.pm25 = v;
        else if (p === 'pm10')             r.pm10 = v;
        else if (p === 'o3')              r.o3 = v;
        else if (p === 'no2')             r.no2 = v;
        else if (p === 'co')              r.co = v;
        else if (p === 'temperature')     r.temperature = v;
        else if (p === 'relativehumidity' || p === 'humidity') r.humidity = v;
      }

      const hasData = Object.values(r).some(v => v !== null);
      if (!hasData) continue;

      const aqi = r.pm25 != null ? pm25ToAQI(r.pm25) : null;
      insertReading.run(
        sensorId, new Date().toISOString(),
        r.pm25, r.pm10, aqi, r.temperature, r.humidity, r.o3, r.no2, r.co,
      );
      collected++;
    } catch (err) {
      console.error(`[OpenAQ] Failed readings for location ${loc.id}:`, err.message);
    }
  }

  console.log(`[OpenAQ] Stored ${collected}/${locations.length} station readings`);
}

async function collectPurpleAir() {
  if (!process.env.PURPLEAIR_READ_KEY) return;

  try {
    const res = await axios.get('https://api.purpleair.com/v1/sensors', {
      headers: { 'X-API-Key': process.env.PURPLEAIR_READ_KEY },
      params: {
        fields: 'name,latitude,longitude,pm2.5,pm2.5_10minute,pm10.0,humidity,temperature',
        location_type: 0,
        nwlng: BENICIA_LON - 0.15,
        nwlat: BENICIA_LAT + 0.15,
        selng: BENICIA_LON + 0.15,
        selat: BENICIA_LAT - 0.15,
      },
      timeout: 15000,
    });

    const { fields = [], data = [] } = res.data;
    const idx = (name) => fields.indexOf(name);

    for (const row of data) {
      const get = (name) => row[idx(name)] ?? null;
      const sensorIndex = get('sensor_index') ?? row[0];
      const sensorId = `purpleair_${sensorIndex}`;

      upsertSensor.run(
        sensorId,
        get('name') || `PurpleAir ${sensorIndex}`,
        'purpleair',
        get('latitude'),
        get('longitude'),
        new Date().toISOString(),
      );

      const pm25raw = get('pm2.5_10minute') ?? get('pm2.5');
      const pm25 = pm25raw != null ? parseFloat(pm25raw) : null;
      const pm10 = get('pm10.0') != null ? parseFloat(get('pm10.0')) : null;
      const tempF = get('temperature');
      const temperature = tempF != null ? Math.round((tempF - 32) * 5 / 9 * 10) / 10 : null;
      const humidity = get('humidity') != null ? parseFloat(get('humidity')) : null;
      const aqi = pm25 != null ? pm25ToAQI(pm25) : null;

      insertReading.run(sensorId, new Date().toISOString(), pm25, pm10, aqi, temperature, humidity, null, null, null);
    }

    console.log(`[PurpleAir] Stored ${data.length} sensor readings`);
  } catch (err) {
    console.error('[PurpleAir] Collection error:', err.message);
  }
}

async function collect() {
  console.log(`[Collector] Running at ${new Date().toISOString()}`);
  await Promise.allSettled([collectOpenAQ(), collectPurpleAir()]);
}

const VALID_INTERVALS = [5, 10, 15, 30, 60];

let currentTask = null;

function cronExpr(minutes) {
  return minutes === 60 ? '0 * * * *' : `*/${minutes} * * * *`;
}

function rescheduleCollector(intervalMinutes) {
  if (!VALID_INTERVALS.includes(intervalMinutes)) throw new Error(`Invalid interval: ${intervalMinutes}`);
  if (currentTask) { currentTask.stop(); currentTask = null; }
  currentTask = cron.schedule(cronExpr(intervalMinutes), collect);
  console.log(`[Collector] Rescheduled — runs every ${intervalMinutes} minutes`);
}

function startCollector(intervalMinutes = 10) {
  collect();
  rescheduleCollector(intervalMinutes);
  console.log(`[Collector] Started — runs every ${intervalMinutes} minutes`);
}

module.exports = { collect, startCollector, rescheduleCollector, VALID_INTERVALS };
