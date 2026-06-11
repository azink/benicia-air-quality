require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { collect, startCollector } = require('./collector');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/sensors', (req, res) => {
  res.json(db.prepare('SELECT * FROM sensors ORDER BY name').all());
});

app.get('/api/readings/latest', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, s.name, s.source, s.latitude, s.longitude
    FROM readings r
    JOIN sensors s ON r.sensor_id = s.sensor_id
    WHERE r.id IN (SELECT MAX(id) FROM readings GROUP BY sensor_id)
    ORDER BY s.name
  `).all();
  res.json(rows);
});

app.get('/api/readings/history', (req, res) => {
  const { sensor_id, hours = 24 } = req.query;
  const since = new Date(Date.now() - Number(hours) * 3600 * 1000).toISOString();

  if (sensor_id) {
    res.json(db.prepare(
      'SELECT * FROM readings WHERE sensor_id = ? AND timestamp >= ? ORDER BY timestamp'
    ).all(sensor_id, since));
  } else {
    res.json(db.prepare(
      `SELECT r.*, s.name FROM readings r
       JOIN sensors s ON r.sensor_id = s.sensor_id
       WHERE r.timestamp >= ? ORDER BY r.timestamp`
    ).all(since));
  }
});

app.get('/api/readings/trend', (req, res) => {
  const { hours = 168 } = req.query;
  const since = new Date(Date.now() - Number(hours) * 3600 * 1000).toISOString();

  const rows = db.prepare(`
    SELECT
      strftime('%Y-%m-%dT%H:00:00', timestamp) AS hour,
      AVG(pm25)        AS avg_pm25,
      AVG(pm10)        AS avg_pm10,
      AVG(aqi)         AS avg_aqi,
      AVG(o3)          AS avg_o3,
      AVG(no2)         AS avg_no2,
      COUNT(*)         AS count
    FROM readings
    WHERE timestamp >= ?
    GROUP BY hour
    ORDER BY hour
  `).all(since);

  res.json(rows);
});

app.get('/api/stats', (req, res) => {
  const sensorCount  = db.prepare('SELECT COUNT(*) AS n FROM sensors').get().n;
  const readingCount = db.prepare('SELECT COUNT(*) AS n FROM readings').get().n;
  const oldest       = db.prepare('SELECT MIN(timestamp) AS t FROM readings').get().t;
  const newest       = db.prepare('SELECT MAX(timestamp) AS t FROM readings').get().t;
  res.json({ sensorCount, readingCount, oldest, newest });
});

app.post('/api/collect', async (req, res) => {
  try {
    await collect();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  startCollector();
});
