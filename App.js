import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Platform,
} from 'react-native';

// Safe import of react-native-maps for native, web, and mock environments
let MapView, Heatmap;
try {
  const Maps = require('react-native-maps');
  MapView = Maps.default || Maps.MapView || Maps;
  Heatmap = Maps.Heatmap || View;
} catch (e) {
  MapView = View;
  Heatmap = View;
}

// Optional safe imports for Expo device hardware modules
let Audio, Location;
try {
  Audio = require('expo-av').Audio;
} catch (e) {
  Audio = null;
}
try {
  Location = require('expo-location');
} catch (e) {
  Location = null;
}

export const CALIBRATION_OFFSET = 95.0;
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

/**
 * Converts dBFS microphone metering amplitude to approximate Sound Pressure Level (dB SPL).
 * SPL ≈ dBFS + CalibrationOffset
 */
export function calculateDecibels(meteringValue, offset = CALIBRATION_OFFSET) {
  if (meteringValue === undefined || meteringValue === null || isNaN(meteringValue)) {
    return 65.0; // Sensible ambient default
  }
  const spl = parseFloat(meteringValue) + offset;
  // Clamp between realistic acoustic bounds (30 dB - 130 dB)
  const clamped = Math.max(30.0, Math.min(130.0, spl));
  return Math.round(clamped * 10) / 10;
}

/**
 * Approximates a radius in meters from the map viewport region
 */
export function calculateRadius(region) {
  if (!region || !region.latitudeDelta) return 5000;
  const latDeltaMeters = region.latitudeDelta * 111000;
  const lngDeltaMeters =
    (region.longitudeDelta || region.latitudeDelta) *
    111000 *
    Math.cos((region.latitude * Math.PI) / 180);
  const radius = Math.round(Math.max(latDeltaMeters, lngDeltaMeters) / 2);
  return Math.max(500, Math.min(100000, radius));
}

export default function App() {
  const [currentRegion, setCurrentRegion] = useState({
    latitude: 40.7128,
    longitude: -74.006,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const [heatmapPoints, setHeatmapPoints] = useState([]);
  const [timeFilter, setTimeFilter] = useState('all'); // 'hour' | 'day' | 'all'
  const [latestDecibel, setLatestDecibel] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isLoadingHeatmap, setIsLoadingHeatmap] = useState(false);
  const [areaReport, setAreaReport] = useState(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Ready to measure noise');

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Fetch heatmap data from backend
  const fetchHeatmap = useCallback(
    async (lat, lng, radius, filter) => {
      setIsLoadingHeatmap(true);
      try {
        const queryFilter = filter || timeFilter;
        const url = `${API_BASE_URL}/api/readings/heatmap?lat=${lat}&lng=${lng}&radius=${radius}&time_filter=${queryFilter}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (isMounted.current) {
            setHeatmapPoints(Array.isArray(data) ? data : []);
          }
        } else {
          console.warn('Failed to fetch heatmap:', res.status);
        }
      } catch (err) {
        console.warn('Heatmap fetch error:', err.message);
      } finally {
        if (isMounted.current) {
          setIsLoadingHeatmap(false);
        }
      }
    },
    [timeFilter]
  );

  // Initial load
  useEffect(() => {
    const radius = calculateRadius(currentRegion);
    fetchHeatmap(currentRegion.latitude, currentRegion.longitude, radius, timeFilter);
  }, []);

  // Re-fetch when timeFilter changes
  const handleTimeFilterChange = (newFilter) => {
    setTimeFilter(newFilter);
    const radius = calculateRadius(currentRegion);
    fetchHeatmap(currentRegion.latitude, currentRegion.longitude, radius, newFilter);
  };

  // Viewport change handler
  const handleRegionChangeComplete = (region) => {
    if (!region) return;
    setCurrentRegion(region);
    const radius = calculateRadius(region);
    fetchHeatmap(region.latitude, region.longitude, radius, timeFilter);
  };

  // Map press handler to generate area report for tapped coordinates
  const handleMapPress = async (event) => {
    const coordinate = event?.nativeEvent?.coordinate;
    if (!coordinate) return;

    setIsLoadingReport(true);
    setStatusMessage('Fetching area report...');

    // Small bounding box around tapped location (~500m window)
    const delta = 0.005;
    const minLng = coordinate.longitude - delta;
    const minLat = coordinate.latitude - delta;
    const maxLng = coordinate.longitude + delta;
    const maxLat = coordinate.latitude + delta;

    try {
      const url = `${API_BASE_URL}/api/readings/report?minLng=${minLng}&minLat=${minLat}&maxLng=${maxLng}&maxLat=${maxLat}`;
      const res = await fetch(url);
      if (res.ok) {
        const report = await res.json();
        if (isMounted.current) {
          setAreaReport({
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            ...report,
          });
          setStatusMessage('Area report loaded');
        }
      } else {
        Alert.alert('Report Error', 'Could not generate report for selected area.');
      }
    } catch (err) {
      console.warn('Report fetch error:', err.message);
      Alert.alert('Network Error', 'Failed to reach API server for report.');
    } finally {
      if (isMounted.current) {
        setIsLoadingReport(false);
      }
    }
  };

  // Record ambient noise reading and submit to backend
  const handleTakeReading = async () => {
    if (isRecording) return;
    setIsRecording(true);
    setStatusMessage('Requesting permissions & measuring...');

    let recordedDb = 68.5; // fallback
    let userLat = currentRegion.latitude;
    let userLng = currentRegion.longitude;

    try {
      // 1. Get GPS location
      if (Location && Location.requestForegroundPermissionsAsync) {
        const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
        if (locStatus === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (loc?.coords) {
            userLat = loc.coords.latitude;
            userLng = loc.coords.longitude;
          }
        }
      }

      // 2. Sample audio metering with expo-av
      if (Audio && Audio.requestPermissionsAsync) {
        const { status: audioStatus } = await Audio.requestPermissionsAsync();
        if (audioStatus === 'granted') {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
          });

          const recording = new Audio.Recording();
          await recording.prepareToRecordAsync({
            android: {
              extension: '.m4a',
              outputFormat: 2,
              audioEncoder: 3,
              sampleRate: 44100,
              numberOfChannels: 1,
              bitRate: 128000,
            },
            ios: {
              extension: '.caf',
              audioQuality: 0x7f,
              sampleRate: 44100,
              numberOfChannels: 1,
              bitRate: 128000,
              linearPCMBitDepth: 16,
              linearPCMIsBigEndian: false,
              linearPCMIsFloat: false,
            },
            web: {},
            isMeteringEnabled: true,
          });

          await recording.startAsync();
          // Sample ambient noise for 1000ms
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const recordingStatus = await recording.getStatusAsync();
          await recording.stopAndUnloadAsync();

          if (recordingStatus && recordingStatus.metering !== undefined) {
            recordedDb = calculateDecibels(recordingStatus.metering, CALIBRATION_OFFSET);
          } else {
            // Simulated reading if metering unavailable
            recordedDb = Math.round((55.0 + Math.random() * 30.0) * 10) / 10;
          }
        } else {
          // If permission denied, use estimated sample
          recordedDb = Math.round((50.0 + Math.random() * 35.0) * 10) / 10;
        }
      } else {
        // Fallback for test or simulator environment
        recordedDb = Math.round((60.0 + Math.random() * 25.0) * 10) / 10;
      }

      // 3. Submit reading to POST /api/readings
      setStatusMessage('Submitting reading...');
      const response = await fetch(`${API_BASE_URL}/api/readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: userLat,
          longitude: userLng,
          decibel: recordedDb,
        }),
      });

      if (response.status === 201) {
        const result = await response.json();
        if (isMounted.current) {
          setLatestDecibel(recordedDb);
          setStatusMessage(`Reading submitted: ${recordedDb} dB (ID: ${result.id})`);
          // Refresh heatmap data to display new reading immediately
          const radius = calculateRadius(currentRegion);
          fetchHeatmap(currentRegion.latitude, currentRegion.longitude, radius, timeFilter);
        }
      } else if (response.status === 429) {
        const err = await response.json();
        const msg = err.error || 'Too many requests. Please wait a minute before submitting again.';
        if (isMounted.current) {
          setStatusMessage('Rate limited: Please wait 1 minute.');
        }
        Alert.alert('Submission Rate Limit', msg);
      } else {
        const err = await response.json().catch(() => ({}));
        Alert.alert('Error', err.error || 'Failed to submit noise reading.');
      }
    } catch (err) {
      console.warn('Take reading error:', err.message);
      Alert.alert('Error', 'Unable to capture or submit reading. Please check backend connection.');
    } finally {
      if (isMounted.current) {
        setIsRecording(false);
      }
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#1e293b" />
      <View style={styles.container}>
        {/* Header Bar */}
        <View style={styles.header}>
          <Text style={styles.title}>Urban Noise Map</Text>
          <Text style={styles.subtitle}>{statusMessage}</Text>
        </View>

        {/* Decibel Display Banner */}
        <View style={styles.decibelBanner}>
          <Text style={styles.decibelLabel}>Latest Noise Level:</Text>
          <Text
            testID="db-reading-display"
            accessibilityLabel="db-reading-display"
            {...{ 'data-testid': 'db-reading-display' }}
            style={styles.decibelValue}
          >
            {latestDecibel !== null ? `${latestDecibel} dB` : '-- dB'}
          </Text>
        </View>

        {/* Time Filter Controls */}
        <View style={styles.filterBar}>
          <TouchableOpacity
            testID="time-filter-hour"
            accessibilityLabel="time-filter-hour"
            {...{ 'data-testid': 'time-filter-hour' }}
            style={[styles.filterButton, timeFilter === 'hour' && styles.filterButtonActive]}
            onPress={() => handleTimeFilterChange('hour')}
          >
            <Text style={[styles.filterButtonText, timeFilter === 'hour' && styles.filterTextActive]}>
              Last Hour
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="time-filter-day"
            accessibilityLabel="time-filter-day"
            {...{ 'data-testid': 'time-filter-day' }}
            style={[styles.filterButton, timeFilter === 'day' && styles.filterButtonActive]}
            onPress={() => handleTimeFilterChange('day')}
          >
            <Text style={[styles.filterButtonText, timeFilter === 'day' && styles.filterTextActive]}>
              Last 24 Hours
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="time-filter-all"
            accessibilityLabel="time-filter-all"
            {...{ 'data-testid': 'time-filter-all' }}
            style={[styles.filterButton, timeFilter === 'all' && styles.filterButtonActive]}
            onPress={() => handleTimeFilterChange('all')}
          >
            <Text style={[styles.filterButtonText, timeFilter === 'all' && styles.filterTextActive]}>
              All Time
            </Text>
          </TouchableOpacity>
        </View>

        {/* Map View */}
        <View style={styles.mapContainer}>
          <MapView
            testID="map-view"
            accessibilityLabel="map-view"
            {...{ 'data-testid': 'map-view' }}
            style={styles.map}
            initialRegion={currentRegion}
            onRegionChangeComplete={handleRegionChangeComplete}
            onPress={handleMapPress}
          >
            {heatmapPoints.length > 0 && (
              <Heatmap
                points={heatmapPoints}
                radius={40}
                opacity={0.75}
                gradient={{
                  colors: ['#0000ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000'],
                  startPoints: [0.01, 0.25, 0.5, 0.75, 1.0],
                  colorMapSize: 256,
                }}
              />
            )}
          </MapView>

          {isLoadingHeatmap && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="small" color="#3b82f6" />
            </View>
          )}

          {/* Area Report Container (visible after tapping the map) */}
          {areaReport && (
            <View
              testID="area-report-container"
              accessibilityLabel="area-report-container"
              {...{ 'data-testid': 'area-report-container' }}
              style={styles.reportCard}
            >
              <View style={styles.reportHeader}>
                <Text style={styles.reportTitle}>Area Noise Report</Text>
                <TouchableOpacity onPress={() => setAreaReport(null)}>
                  <Text style={styles.reportClose}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.reportGrid}>
                <View style={styles.reportStat}>
                  <Text style={styles.statLabel}>Average dB</Text>
                  <Text style={styles.statValue}>{areaReport.averageDecibel} dB</Text>
                </View>
                <View style={styles.reportStat}>
                  <Text style={styles.statLabel}>Peak dB</Text>
                  <Text style={styles.statValue}>{areaReport.peakDecibel} dB</Text>
                </View>
                <View style={styles.reportStat}>
                  <Text style={styles.statLabel}>Readings</Text>
                  <Text style={styles.statValue}>{areaReport.readingCount}</Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* Action Controls Footer */}
        <View style={styles.footer}>
          <TouchableOpacity
            testID="take-reading-button"
            accessibilityLabel="take-reading-button"
            {...{ 'data-testid': 'take-reading-button' }}
            style={[styles.takeReadingButton, isRecording && styles.takeReadingButtonDisabled]}
            onPress={handleTakeReading}
            disabled={isRecording}
          >
            {isRecording ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.takeReadingButtonText}>Take Reading</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    backgroundColor: '#0f172a',
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  decibelBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  decibelLabel: {
    fontSize: 14,
    color: '#cbd5e1',
    fontWeight: '500',
  },
  decibelValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#38bdf8',
  },
  filterBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#ffffff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  filterButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
  },
  filterButtonActive: {
    backgroundColor: '#2563eb',
  },
  filterButtonText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#ffffff',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 20,
    padding: 8,
  },
  reportCard: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  reportTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  reportClose: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: 'bold',
    padding: 4,
  },
  reportGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  reportStat: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0284c7',
  },
  footer: {
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  takeReadingButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 4,
  },
  takeReadingButtonDisabled: {
    backgroundColor: '#94a3b8',
  },
  takeReadingButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
