const express = require('express');
const router = express.Router();
const db = require('../db');
const rateLimiter = require('../middleware/rateLimiter');

/**
 * POST /api/readings
 * Submits a new noise reading with GPS coordinates and decibel level.
 * Rate-limited to 1 successful submission per minute per IP.
 */
router.post('/', rateLimiter, async (req, res, next) => {
  try {
    const { latitude, longitude, decibel, decibel_level } = req.body;
    const dbValue = decibel !== undefined ? decibel : decibel_level;

    if (latitude === undefined || longitude === undefined || dbValue === undefined) {
      return res.status(400).json({
        error: "latitude, longitude, and decibel are required fields"
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const dbNum = parseFloat(dbValue);

    if (isNaN(lat) || isNaN(lng) || isNaN(dbNum)) {
      return res.status(400).json({
        error: "latitude, longitude, and decibel must be valid numbers"
      });
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        error: "Coordinates out of bounds (-90 <= latitude <= 90, -180 <= longitude <= 180)"
      });
    }

    // Insert into PostgreSQL with PostGIS Point geometry (SRID 4326)
    // ST_MakePoint takes (longitude, latitude)
    const query = `
      INSERT INTO readings (decibel_level, location)
      VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326))
      RETURNING id;
    `;
    const result = await db.query(query, [dbNum, lng, lat]);
    const newId = result.rows[0].id;

    return res.status(201).json({
      status: "success",
      id: newId
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/readings/heatmap
 * Fetches noise readings within a radius of a center coordinate, optionally filtered by time.
 * Query params: lat, lng, radius, time_filter ('hour', 'day', 'all')
 */
router.get('/heatmap', async (req, res, next) => {
  try {
    const { lat, lng, radius, time_filter } = req.query;

    if (lat === undefined || lng === undefined || radius === undefined) {
      return res.status(400).json({
        error: "lat, lng, and radius are required query parameters"
      });
    }

    const centerLat = parseFloat(lat);
    const centerLng = parseFloat(lng);
    const searchRadius = parseFloat(radius);

    if (isNaN(centerLat) || isNaN(centerLng) || isNaN(searchRadius)) {
      return res.status(400).json({
        error: "lat, lng, and radius must be valid numbers"
      });
    }

    let timeFilterClause = '';
    const filter = (time_filter || 'all').toLowerCase();
    if (filter === 'hour') {
      timeFilterClause = "AND created_at >= NOW() - INTERVAL '1 hour'";
    } else if (filter === 'day') {
      timeFilterClause = "AND created_at >= NOW() - INTERVAL '24 hours'";
    }

    // ST_DWithin on geography calculates distance in meters on Earth's spheroid
    const query = `
      SELECT
        ST_Y(location) AS latitude,
        ST_X(location) AS longitude,
        decibel_level AS weight
      FROM readings
      WHERE ST_DWithin(
        location::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $3
      )
      ${timeFilterClause}
      ORDER BY created_at DESC;
    `;

    const result = await db.query(query, [centerLng, centerLat, searchRadius]);

    const data = result.rows.map((row) => ({
      latitude: parseFloat(Number(row.latitude).toFixed(6)),
      longitude: parseFloat(Number(row.longitude).toFixed(6)),
      weight: parseFloat(Number(row.weight).toFixed(2))
    }));

    return res.status(200).json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/readings/report
 * Calculates aggregate noise statistics (average dB, peak dB, reading count) for a given bounding box.
 * Query params: minLng, minLat, maxLng, maxLat
 */
router.get('/report', async (req, res, next) => {
  try {
    const { minLng, minLat, maxLng, maxLat } = req.query;

    if (minLng === undefined || minLat === undefined || maxLng === undefined || maxLat === undefined) {
      return res.status(400).json({
        error: "minLng, minLat, maxLng, and maxLat query parameters are required"
      });
    }

    const xMin = parseFloat(minLng);
    const yMin = parseFloat(minLat);
    const xMax = parseFloat(maxLng);
    const yMax = parseFloat(maxLat);

    if ([xMin, yMin, xMax, yMax].some(isNaN)) {
      return res.status(400).json({
        error: "Bounding box coordinates must be valid numbers"
      });
    }

    // ST_MakeEnvelope(xmin, ymin, xmax, ymax, srid)
    // location && ST_MakeEnvelope uses the 2D bounding box spatial GiST index
    const query = `
      SELECT
        COALESCE(AVG(decibel_level), 0) AS average_decibel,
        COALESCE(MAX(decibel_level), 0) AS peak_decibel,
        COUNT(*)::int AS reading_count
      FROM readings
      WHERE location && ST_MakeEnvelope($1, $2, $3, $4, 4326);
    `;

    const result = await db.query(query, [xMin, yMin, xMax, yMax]);
    const row = result.rows[0];

    const readingCount = parseInt(row.reading_count, 10) || 0;
    const averageDecibel = readingCount > 0 ? Math.round(parseFloat(row.average_decibel) * 10) / 10 : 0;
    const peakDecibel = readingCount > 0 ? Math.round(parseFloat(row.peak_decibel) * 10) / 10 : 0;

    return res.status(200).json({
      averageDecibel,
      peakDecibel,
      readingCount
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
