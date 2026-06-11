const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'air_quality.db'));

db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sensors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_id  TEXT    UNIQUE NOT NULL,
    name       TEXT    NOT NULL,
    source     TEXT    NOT NULL,
    latitude   REAL,
    longitude  REAL,
    last_seen  TEXT
  );

  CREATE TABLE IF NOT EXISTS readings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_id   TEXT    NOT NULL,
    timestamp   TEXT    NOT NULL,
    pm25        REAL,
    pm10        REAL,
    aqi         INTEGER,
    temperature REAL,
    humidity    REAL,
    o3          REAL,
    no2         REAL,
    co          REAL,
    FOREIGN KEY (sensor_id) REFERENCES sensors(sensor_id)
  );

  CREATE INDEX IF NOT EXISTS idx_readings_sensor_time ON readings(sensor_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_readings_timestamp   ON readings(timestamp);
`);

module.exports = db;
