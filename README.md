# Community Noise Map

A full-stack, crowdsourced urban noise pollution mapping application built with **React Native (Expo)**, **Node.js (Express)**, **PostgreSQL**, and **PostGIS**.

---

## 1. System Architecture

```
+-------------------------------------------------------------+
|                 React Native (Expo) Client                  |
|  - Hardware Access: Microphone (expo-av) & GPS (expo-loc)   |
|  - Interactive Heatmap: react-native-maps <MapView>         |
|  - Decibel Conversion: SPL ≈ dBFS + 95.0 dB                 |
+------------------------------+------------------------------+
                               | REST API (HTTP / JSON)
                               v
+-------------------------------------------------------------+
|                   Node.js & Express API                     |
|  - Rate Limiting Middleware (1 request/min per IP)          |
|  - Endpoints: POST /readings, GET /heatmap, GET /report     |
+------------------------------+------------------------------+
                               | pg pool
                               v
+-------------------------------------------------------------+
|                  PostgreSQL + PostGIS Database              |
|  - Geometry: GEOMETRY(Point, 4326)                          |
|  - Spatial Index: GiST (readings_location_idx)              |
|  - Spatial Functions: ST_DWithin, ST_MakeEnvelope, ST_X/Y   |
+-------------------------------------------------------------+
```

---

## 2. Core Features & Endpoints

### A. Record & Submit Noise Reading
- **Endpoint:** `POST /api/readings`
- **Rate Limit:** 1 submission per minute per client IP (`429 Too Many Requests`).
- **Payload:**
  ```json
  {
    "latitude": 40.7128,
    "longitude": -74.0060,
    "decibel": 75.2
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "status": "success",
    "id": 1
  }
  ```

### B. View Heatmap Readings
- **Endpoint:** `GET /api/readings/heatmap?lat=40.7128&lng=-74.0060&radius=1000&time_filter=all`
- **Parameters:**
  - `lat` (float, required): Center latitude.
  - `lng` (float, required): Center longitude.
  - `radius` (float, required): Search radius in meters.
  - `time_filter` (string, optional): `"hour"`, `"day"`, or `"all"`.
- **Response (200 OK):**
  ```json
  [
    {
      "latitude": 40.7128,
      "longitude": -74.006,
      "weight": 65.5
    }
  ]
  ```

### C. Area Report (Bounding Box Aggregation)
- **Endpoint:** `GET /api/readings/report?minLng=-74.01&minLat=40.70&maxLng=-74.00&maxLat=40.72`
- **Parameters:** `minLng`, `minLat`, `maxLng`, `maxLat` (floats, required).
- **Response (200 OK):**
  ```json
  {
    "averageDecibel": 68.4,
    "peakDecibel": 85.1,
    "readingCount": 42
  }
  ```

---

## 3. Quickstart with Docker Compose

Run the entire containerized stack:

```bash
docker-compose up --build
```

- Both `db` (PostGIS) and `api` services automatically start.
- `migration.sql` initializes the `readings` table and GiST index automatically on first launch.
- Healthchecks ensure `api` waits for `db` to be healthy before starting.
- API is accessible at `http://localhost:3000`.

---

## 4. Database Schema (`db/migration.sql`)

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS readings (
  id SERIAL PRIMARY KEY,
  decibel_level FLOAT NOT NULL,
  location GEOMETRY(Point, 4326) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS readings_location_idx ON readings USING GIST (location);
```

---

## 5. Automated Testing

To run the test suite:

```bash
npm test
```

Includes tests for:
- API endpoints (`POST /api/readings`, `GET /api/readings/heatmap`, `GET /api/readings/report`)
- 60-second in-memory IP rate limiter
- Sound pressure level (dB SPL) conversion formulas
- React Native component `data-testid` tags and event handlers
- Decibel derivation documentation verification
