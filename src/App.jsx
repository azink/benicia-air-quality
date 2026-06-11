import { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import './App.css';

// ── AQI helpers ────────────────────────────────────────────────────────────

const AQI_LEVELS = [
  { max: 50,  label: 'Good',                         color: '#16a34a' },
  { max: 100, label: 'Moderate',                     color: '#ca8a04' },
  { max: 150, label: 'Unhealthy for Sensitive Groups', color: '#ea580c' },
  { max: 200, label: 'Unhealthy',                    color: '#dc2626' },
  { max: 300, label: 'Very Unhealthy',               color: '#9333ea' },
  { max: 500, label: 'Hazardous',                    color: '#991b1b' },
];

function aqiLevel(aqi) {
  if (aqi == null) return { label: 'No Data', color: '#94a3b8' };
  return AQI_LEVELS.find(l => aqi <= l.max) ?? AQI_LEVELS.at(-1);
}

function fmt1(n)    { return n != null ? Number(n).toFixed(1) : '—'; }
function fmtAQI(n)  { return n != null ? Math.round(n) : '—'; }

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDateTime(d) {
  if (!d) return '';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const aqi = Math.round(payload[0]?.value ?? 0);
  const lv  = aqiLevel(aqi);
  return (
    <div className="chart-tip">
      <div className="chart-tip-time">{label}</div>
      <div className="chart-tip-aqi" style={{ color: lv.color }}>AQI {aqi} — {lv.label}</div>
      {payload[1]?.value != null && (
        <div className="chart-tip-pm">PM2.5: {fmt1(payload[1].value)} µg/m³</div>
      )}
    </div>
  );
}

const TIME_RANGES = [
  { label: '24h', hours: 24 },
  { label: '7d',  hours: 168 },
  { label: '30d', hours: 720 },
];

function TrendSection({ data, timeRange, onTimeRangeChange }) {
  const chartData = data
    .map(d => {
      const date = new Date(d.hour);
      const label = timeRange <= 24
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
            + ' ' + date.toLocaleTimeString([], { hour: '2-digit' });
      return {
        time: label,
        aqi:  d.avg_aqi  != null ? Math.round(d.avg_aqi)  : null,
        pm25: d.avg_pm25 != null ? Number(d.avg_pm25).toFixed(1) : null,
      };
    })
    .filter(d => d.aqi != null);

  return (
    <div className="card trend-card">
      <div className="trend-header">
        <div>
          <div className="section-title">AQI Trend</div>
          <div className="section-subtitle">Hourly average across all sensors</div>
        </div>
        <div className="time-toggle">
          {TIME_RANGES.map(r => (
            <button
              key={r.hours}
              className={`time-btn${timeRange === r.hours ? ' active' : ''}`}
              onClick={() => onTimeRangeChange(r.hours)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {chartData.length === 0 ? (
        <div className="empty-chart">No trend data yet — check back after a few collections.</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 5, right: 16, left: -24, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} domain={[0, 'auto']} />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine y={50}  stroke="#16a34a" strokeDasharray="4 4" strokeOpacity={0.3} />
            <ReferenceLine y={100} stroke="#ca8a04" strokeDasharray="4 4" strokeOpacity={0.3} />
            <ReferenceLine y={150} stroke="#ea580c" strokeDasharray="4 4" strokeOpacity={0.3} />
            <Line type="monotone" dataKey="aqi"  stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="AQI" />
            <Line type="monotone" dataKey="pm25" stroke="#94a3b8" strokeWidth={1} dot={false} name="PM2.5" strokeDasharray="3 3" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function SensorCard({ reading }) {
  const lv = aqiLevel(reading.aqi);
  return (
    <div className="sensor-card" style={{ borderTopColor: lv.color }}>
      <div className="sc-header">
        <div className="sc-name">{reading.name}</div>
        <span className={`badge badge--${reading.source}`}>{reading.source}</span>
      </div>
      <div className="sc-aqi" style={{ color: lv.color }}>{fmtAQI(reading.aqi)}</div>
      <div className="sc-level" style={{ color: lv.color }}>{lv.label}</div>
      <div className="sc-stats">
        <div>
          <span className="sc-stat-label">PM2.5</span>
          <span className="sc-stat-val">{fmt1(reading.pm25)} <small>µg/m³</small></span>
        </div>
        <div>
          <span className="sc-stat-label">PM10</span>
          <span className="sc-stat-val">{fmt1(reading.pm10)} <small>µg/m³</small></span>
        </div>
        {reading.o3 != null && (
          <div>
            <span className="sc-stat-label">O₃</span>
            <span className="sc-stat-val">{fmt1(reading.o3)} <small>ppb</small></span>
          </div>
        )}
        {reading.no2 != null && (
          <div>
            <span className="sc-stat-label">NO₂</span>
            <span className="sc-stat-val">{fmt1(reading.no2)} <small>ppb</small></span>
          </div>
        )}
        {reading.temperature != null && (
          <div>
            <span className="sc-stat-label">Temp</span>
            <span className="sc-stat-val">{fmt1(reading.temperature)} <small>°C</small></span>
          </div>
        )}
        {reading.humidity != null && (
          <div>
            <span className="sc-stat-label">Humidity</span>
            <span className="sc-stat-val">{fmt1(reading.humidity)} <small>%</small></span>
          </div>
        )}
      </div>
      <div className="sc-updated">Last reading {fmtTime(reading.timestamp)}</div>
    </div>
  );
}

// ── Main app ───────────────────────────────────────────────────────────────

export default function App() {
  const [latest,      setLatest]      = useState([]);
  const [trend,       setTrend]       = useState([]);
  const [timeRange,   setTimeRange]   = useState(24);
  const [loading,     setLoading]     = useState(true);
  const [collecting,  setCollecting]  = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error,       setError]       = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [lat, trnd] = await Promise.all([
        fetch('/api/readings/latest').then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); }),
        fetch(`/api/readings/trend?hours=${timeRange}`).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); }),
      ]);
      setLatest(Array.isArray(lat)  ? lat  : []);
      setTrend(Array.isArray(trnd) ? trnd : []);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError('Could not reach the server. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const triggerCollect = async () => {
    setCollecting(true);
    try {
      await fetch('/api/collect', { method: 'POST' });
      await fetchData();
    } finally {
      setCollecting(false);
    }
  };

  const validReadings = latest.filter(r => r.aqi != null);
  const avgAQI = validReadings.length
    ? Math.round(validReadings.reduce((s, r) => s + r.aqi, 0) / validReadings.length)
    : null;
  const avgPM25 = (() => {
    const rows = latest.filter(r => r.pm25 != null);
    return rows.length ? rows.reduce((s, r) => s + r.pm25, 0) / rows.length : null;
  })();
  const lv = aqiLevel(avgAQI);
  const sources = [...new Set(latest.map(r => r.source))];

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Benicia Air Quality</h1>
          <div className="header-subtitle">Benicia, CA — real-time monitoring</div>
        </div>
        <div className="header-right">
          {lastUpdated && (
            <span className="last-updated">Updated {fmtDateTime(lastUpdated)}</span>
          )}
          <button className="btn-primary" onClick={triggerCollect} disabled={collecting}>
            {collecting ? 'Collecting…' : 'Collect Now'}
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading">Loading air quality data…</div>
      ) : (
        <>
          {/* Overview cards */}
          <div className="overview-row">
            <div className="card" style={{ borderTop: `3px solid ${lv.color}` }}>
              <div className="ov-label">Current AQI</div>
              <div className="ov-aqi" style={{ color: lv.color }}>{fmtAQI(avgAQI)}</div>
              <div className="ov-aqi-label" style={{ color: lv.color }}>{lv.label}</div>
            </div>
            <div className="card">
              <div className="ov-label">PM2.5 Average</div>
              <div className="ov-value">{fmt1(avgPM25)}</div>
              <div className="ov-unit">µg/m³</div>
            </div>
            <div className="card">
              <div className="ov-label">Active Sensors</div>
              <div className="ov-value">{latest.length}</div>
              <div className="ov-unit">stations reporting</div>
            </div>
            <div className="card">
              <div className="ov-label">Data Sources</div>
              <div className="source-list">
                {sources.length > 0
                  ? sources.map(s => <span key={s} className={`badge badge--${s}`}>{s}</span>)
                  : <span style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>None yet</span>
                }
              </div>
            </div>
          </div>

          {/* Trend chart */}
          <TrendSection
            data={trend}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
          />

          {/* Sensor cards */}
          <div className="sensors-header">
            <div className="section-title">Sensors</div>
          </div>
          {latest.length === 0 ? (
            <div className="card empty-state">
              <p>No sensors found yet.</p>
              <p>
                Click <strong>Collect Now</strong> or wait for the next scheduled run.
                Make sure your API keys are set in <code>.env</code> (see <code>.env.example</code>).
              </p>
            </div>
          ) : (
            <div className="sensor-grid">
              {latest.map(r => <SensorCard key={r.sensor_id} reading={r} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
