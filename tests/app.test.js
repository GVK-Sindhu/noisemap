const fs = require('fs');
const path = require('path');
const React = require('react');

// Test suite for React Native Noise Map UI structure and helper logic
describe('React Native Community Noise Map & Documentation Verification', () => {
  describe('Requirement 7: Decibel Derivation Documentation (docs/db_derivation.md)', () => {
    const docPath = path.join(__dirname, '..', 'docs', 'db_derivation.md');

    it('verifies that docs/db_derivation.md exists', () => {
      expect(fs.existsSync(docPath)).toBe(true);
    });

    it('verifies explanation of dBFS vs SPL', () => {
      const content = fs.readFileSync(docPath, 'utf8');
      expect(content).toMatch(/dBFS/);
      expect(content).toMatch(/Sound Pressure Level|SPL/);
      expect(content).toMatch(/full scale/i);
      expect(content).toMatch(/20\s*(?:\\mu\s*Pa|\* 10\^\{-6\}|micro-Pascals)/i);
    });

    it('verifies numerical calibration offset value statement', () => {
      const content = fs.readFileSync(docPath, 'utf8');
      expect(content).toMatch(/SPL\s*≈\s*dBFS\s*\+\s*CalibrationOffset/);
      expect(content).toMatch(/95(?:\.0)?\s*dB/);
    });

    it('verifies technical rationale for the chosen offset value', () => {
      const content = fs.readFileSync(docPath, 'utf8');
      expect(content).toMatch(/rationale/i);
      expect(content).toMatch(/microphone|acoustic|clipping|sensitivity/i);
    });
  });

  describe('Decibel Conversion and Viewport Utilities', () => {
    const {
      calculateDecibels,
      calculateRadius,
      CALIBRATION_OFFSET,
    } = require('../App');

    it('has CALIBRATION_OFFSET configured to 95 dB', () => {
      expect(CALIBRATION_OFFSET).toBe(95.0);
    });

    it('correctly calculates decibel SPL using SPL = dBFS + CalibrationOffset', () => {
      // e.g. -30 dBFS + 95 = 65 dB SPL
      expect(calculateDecibels(-30)).toBe(65.0);
      // -52 dBFS + 95 = 43 dB SPL
      expect(calculateDecibels(-52)).toBe(43.0);
      // -18.2 dBFS + 95 = 76.8 dB SPL
      expect(calculateDecibels(-18.2)).toBe(76.8);
    });

    it('clamps to realistic acoustic bounds', () => {
      // Extremely loud or clipping
      expect(calculateDecibels(50)).toBe(130.0);
      // Extremely low or silent
      expect(calculateDecibels(-120)).toBe(30.0);
    });

    it('calculates geographic search radius in meters from map region', () => {
      const region = {
        latitude: 40.7128,
        longitude: -74.006,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
      const radius = calculateRadius(region);
      expect(radius).toBeGreaterThan(1000);
      expect(radius).toBeLessThan(10000);
    });
  });

  describe('Requirement 8: UI Elements with data-testid attributes', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');

    it('contains Take Reading Button with data-testid="take-reading-button"', () => {
      expect(appSource).toMatch(/data-testid=["']take-reading-button["']/);
      expect(appSource).toMatch(/testID=["']take-reading-button["']/);
    });

    it('contains Decibel Display with data-testid="db-reading-display"', () => {
      expect(appSource).toMatch(/data-testid=["']db-reading-display["']/);
      expect(appSource).toMatch(/testID=["']db-reading-display["']/);
    });

    it('contains Map View with data-testid="map-view"', () => {
      expect(appSource).toMatch(/data-testid=["']map-view["']/);
      expect(appSource).toMatch(/testID=["']map-view["']/);
    });

    it('contains Time Filter Controls with data-testid attributes for hour, day, and all', () => {
      expect(appSource).toMatch(/data-testid=["']time-filter-hour["']/);
      expect(appSource).toMatch(/testID=["']time-filter-hour["']/);

      expect(appSource).toMatch(/data-testid=["']time-filter-day["']/);
      expect(appSource).toMatch(/testID=["']time-filter-day["']/);

      expect(appSource).toMatch(/data-testid=["']time-filter-all["']/);
      expect(appSource).toMatch(/testID=["']time-filter-all["']/);
    });

    it('contains Area Report Display with data-testid="area-report-container"', () => {
      expect(appSource).toMatch(/data-testid=["']area-report-container["']/);
      expect(appSource).toMatch(/testID=["']area-report-container["']/);
    });
  });

  describe('Requirement 9: Dynamic Map Viewport Reloading', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');

    it('attaches onRegionChangeComplete handler to MapView', () => {
      expect(appSource).toMatch(/onRegionChangeComplete=\{handleRegionChangeComplete\}/);
    });

    it('calls /api/readings/heatmap with updated coordinates and radius', () => {
      expect(appSource).toMatch(/\/api\/readings\/heatmap\?lat=/);
      expect(appSource).toMatch(/radius=/);
      expect(appSource).toMatch(/time_filter=/);
    });

    it('attaches onPress handler to MapView for area report queries', () => {
      expect(appSource).toMatch(/onPress=\{handleMapPress\}/);
      expect(appSource).toMatch(/\/api\/readings\/report\?minLng=/);
    });
  });
});
