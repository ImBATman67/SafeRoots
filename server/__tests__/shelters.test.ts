import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index';
import { getDb } from '../../src/db';

describe('Shelters API', () => {
  beforeAll(() => {
    // Initialize database if needed
    getDb();
  });

  describe('GET /api/shelters', () => {
    it('should return an array of shelters', async () => {
      const res = await request(app).get('/api/shelters');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should filter shelters by city', async () => {
      const res = await request(app).get('/api/shelters?city=Chicago');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        res.body.forEach((shelter: any) => {
          expect(shelter.city?.toLowerCase()).toContain('chicago');
        });
      }
    });

    it('should filter shelters by minimum rating', async () => {
      const res = await request(app).get('/api/shelters?minRating=3.5');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        res.body.forEach((shelter: any) => {
          expect(shelter.rating).toBeGreaterThanOrEqual(3.5);
        });
      }
    });

    it('should reject invalid minRating', async () => {
      const res = await request(app).get('/api/shelters?minRating=invalid');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject invalid query parameters', async () => {
      const res = await request(app).get('/api/shelters?minRating=6');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/api/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Not found');
    });
  });
});
