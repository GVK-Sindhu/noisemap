const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const rateLimiter = require('../src/middleware/rateLimiter');

describe('Noise Map API Endpoints & Middleware', () => {
  beforeEach(() => {
    rateLimiter.reset();
  });

  describe('Healthcheck Endpoint', () => {
    it('GET /health returns 200 and healthy status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
    });
  });

  describe('POST /api/readings', () => {
    it('successfully submits a valid noise reading', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [{ id: 101 }]
      });

      const payload = {
        latitude: 40.7128,
        longitude: -74.006,
        decibel: 75.2
      };

      const res = await request(app)
        .post('/api/readings')
        .set('X-Forwarded-For', '192.168.1.10')
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        status: 'success',
        id: 101
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO readings'),
        [75.2, -74.006, 40.7128]
      );

      db.query.mockRestore();
    });

    it('rejects missing or invalid payload fields with 400', async () => {
      const res = await request(app)
        .post('/api/readings')
        .set('X-Forwarded-For', '192.168.1.11')
        .send({ latitude: 40.7128 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects out of bounds coordinates with 400', async () => {
      const res = await request(app)
        .post('/api/readings')
        .set('X-Forwarded-For', '192.168.1.12')
        .send({
          latitude: 95.0, // Invalid lat > 90
          longitude: -74.006,
          decibel: 60.0
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Coordinates out of bounds');
    });
  });

  describe('Rate Limiting on POST /api/readings', () => {
    it('blocks second request from same IP within 60 seconds with 429', async () => {
      jest.spyOn(db, 'query').mockResolvedValue({
        rows: [{ id: 102 }]
      });

      const clientIp = '203.0.113.195';

      // First request succeeds (201)
      const res1 = await request(app)
        .post('/api/readings')
        .set('X-Forwarded-For', clientIp)
        .send({ latitude: 40.7128, longitude: -74.006, decibel: 70.0 });

      expect(res1.status).toBe(201);
      expect(res1.body.status).toBe('success');

      // Second immediate request from same IP is rate-limited (429)
      const res2 = await request(app)
        .post('/api/readings')
        .set('X-Forwarded-For', clientIp)
        .send({ latitude: 40.7128, longitude: -74.006, decibel: 72.5 });

      expect(res2.status).toBe(429);
      expect(res2.body).toEqual({
        error: 'Too many requests. Please wait a minute before submitting again.'
      });

      // Request from a different IP is permitted
      const resDiffIp = await request(app)
        .post('/api/readings')
        .set('X-Forwarded-For', '203.0.113.196')
        .send({ latitude: 40.7128, longitude: -74.006, decibel: 68.0 });

      expect(resDiffIp.status).toBe(201);

      db.query.mockRestore();
    });

    it('allows a third request after 61 seconds have elapsed', async () => {
      jest.spyOn(db, 'query').mockResolvedValue({
        rows: [{ id: 103 }]
      });

      const clientIp = '198.51.100.42';

      // Initial request succeeds
      const res1 = await request(app)
        .post('/api/readings')
        .set('X-Forwarded-For', clientIp)
        .send({ latitude: 40.7128, longitude: -74.006, decibel: 65.0 });

      expect(res1.status).toBe(201);

      // Simulate passage of 61 seconds by advancing the timestamp backwards
      const recordedTime = rateLimiter.getTimestamp(clientIp);
      expect(recordedTime).toBeDefined();
      rateLimiter.setTimestamp(clientIp, recordedTime - 61000);

      // Third request now succeeds
      const res3 = await request(app)
        .post('/api/readings')
        .set('X-Forwarded-For', clientIp)
        .send({ latitude: 40.7128, longitude: -74.006, decibel: 67.0 });

      expect(res3.status).toBe(201);

      db.query.mockRestore();
    });
  });

  describe('GET /api/readings/heatmap', () => {
    it('fetches readings within radius using ST_DWithin', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [
          { latitude: 40.7128, longitude: -74.006, weight: 65.5 },
          { latitude: 40.7135, longitude: -74.0055, weight: 72.1 }
        ]
      });

      const res = await request(app)
        .get('/api/readings/heatmap')
        .query({ lat: 40.7128, lng: -74.006, radius: 1000 });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toEqual({
        latitude: 40.7128,
        longitude: -74.006,
        weight: 65.5
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ST_DWithin'),
        [-74.006, 40.7128, 1000]
      );

      db.query.mockRestore();
    });

    it('applies time_filter for "hour" and "day"', async () => {
      const mockQuery = jest.spyOn(db, 'query').mockResolvedValue({ rows: [] });

      await request(app)
        .get('/api/readings/heatmap')
        .query({ lat: 40.7128, lng: -74.006, radius: 500, time_filter: 'hour' });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("NOW() - INTERVAL '1 hour'"),
        [-74.006, 40.7128, 500]
      );

      await request(app)
        .get('/api/readings/heatmap')
        .query({ lat: 40.7128, lng: -74.006, radius: 500, time_filter: 'day' });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("NOW() - INTERVAL '24 hours'"),
        [-74.006, 40.7128, 500]
      );

      mockQuery.mockRestore();
    });

    it('returns 400 when missing required query parameters', async () => {
      const res = await request(app)
        .get('/api/readings/heatmap')
        .query({ lat: 40.7128 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('lat, lng, and radius are required');
    });
  });

  describe('GET /api/readings/report', () => {
    it('computes aggregate statistics for a bounding box', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [{
          average_decibel: '68.42',
          peak_decibel: '85.1',
          reading_count: '42'
        }]
      });

      const res = await request(app)
        .get('/api/readings/report')
        .query({
          minLng: -74.01,
          minLat: 40.70,
          maxLng: -74.00,
          maxLat: 40.72
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        averageDecibel: 68.4,
        peakDecibel: 85.1,
        readingCount: 42
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ST_MakeEnvelope'),
        [-74.01, 40.70, -74.00, 40.72]
      );

      db.query.mockRestore();
    });

    it('returns zeroes when bounding box contains 0 readings', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [{
          average_decibel: '0',
          peak_decibel: '0',
          reading_count: '0'
        }]
      });

      const res = await request(app)
        .get('/api/readings/report')
        .query({
          minLng: -74.01,
          minLat: 40.70,
          maxLng: -74.00,
          maxLat: 40.72
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        averageDecibel: 0,
        peakDecibel: 0,
        readingCount: 0
      });

      db.query.mockRestore();
    });

    it('returns 400 when bounding box coordinates are missing', async () => {
      const res = await request(app)
        .get('/api/readings/report')
        .query({ minLng: -74.01, minLat: 40.70 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });
  });
});
