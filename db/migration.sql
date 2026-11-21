-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Helper functions for latitude and longitude (PostGIS compatibility)
CREATE OR REPLACE FUNCTION latitude(geom geometry) RETURNS float AS $$
  SELECT ST_Y(geom);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION longitude(geom geometry) RETURNS float AS $$
  SELECT ST_X(geom);
$$ LANGUAGE sql IMMUTABLE;

-- Create the readings table
CREATE TABLE IF NOT EXISTS readings (
  id SERIAL PRIMARY KEY,
  decibel_level FLOAT NOT NULL,
  location GEOMETRY(Point, 4326) NOT NULL, -- SRID 4326 for GPS coordinates
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create a spatial index for fast location-based queries
CREATE INDEX IF NOT EXISTS readings_location_idx ON readings USING GIST (location);
