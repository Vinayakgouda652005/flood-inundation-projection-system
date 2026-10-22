
/**
 * Flood Service Layer (API Client)
 *
 * Connects the React frontend to the FastAPI backend.
 * Supports location-based predictions, weather data integration,
 * manual environmental feature overrides, and existing dashboard methods.
 */

import {
  BASIN_LOCATIONS,
  CURRENT_SUMMARY,
  FORECAST_TIMELINE,
  HYDRO_STATIONS,
  AFFECTED_LOCATIONS,
  INUNDATION_POLYGONS,
  RIVER_CENTERLINE,
  SETTLEMENT_MARKERS,
  ROAD_SEGMENTS,
  INITIAL_PREDICTION_RESULT,
} from '../data/mockData.js';

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
).replace(/\/+$/, '');

export const PRESET_LOCATIONS = [
  { name: 'Bengaluru, Karnataka', latitude: 12.9716, longitude: 77.5946, region: 'South' },
  { name: 'Vijayawada, Krishna Basin, Andhra Pradesh', latitude: 16.5062, longitude: 80.648, region: 'East Coast' },
  { name: 'Patna, Ganga Basin, Bihar', latitude: 25.5941, longitude: 85.1376, region: 'Ganges Plains' },
  { name: 'Guwahati, Brahmaputra Basin, Assam', latitude: 26.1445, longitude: 91.7362, region: 'North East' },
  { name: 'Cuttack, Mahanadi Delta, Odisha', latitude: 20.4625, longitude: 85.883, region: 'East Coast' },
  { name: 'Varanasi, Middle Ganga, Uttar Pradesh', latitude: 25.3176, longitude: 82.9739, region: 'Ganges Plains' },
  { name: 'Mumbai, Mithi Basin, Maharashtra', latitude: 19.076, longitude: 72.8777, region: 'West Coast' },
  { name: 'Chennai, Adyar & Cooum Basins, Tamil Nadu', latitude: 13.0827, longitude: 80.2707, region: 'South' },
  { name: 'Kolkata, Hooghly Basin, West Bengal', latitude: 22.5726, longitude: 88.3639, region: 'East' },
  { name: 'Delhi, Yamuna Floodplain, NCR', latitude: 28.6139, longitude: 77.209, region: 'North' },
  { name: 'Srinagar, Jhelum Basin, Jammu & Kashmir', latitude: 34.0837, longitude: 74.7973, region: 'North' },
  { name: 'Surat, Tapi Basin, Gujarat', latitude: 21.1702, longitude: 72.8311, region: 'West' },
  { name: 'Kochi, Periyar Basin, Kerala', latitude: 9.9312, longitude: 76.2673, region: 'South' },
  { name: 'Hyderabad, Musi Basin, Telangana', latitude: 17.385, longitude: 78.4867, region: 'South' },
  { name: 'Pune, Mula-Mutha Basin, Maharashtra', latitude: 18.5204, longitude: 73.8567, region: 'West' },
  { name: 'Ahmedabad, Sabarmati Basin, Gujarat', latitude: 23.0225, longitude: 72.5714, region: 'West' },
];

/* -------------------- API REQUEST -------------------- */

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    let detail = responseText || `API request failed (${response.status})`;

    try {
      const parsed = JSON.parse(responseText);
      detail = parsed.detail ?? detail;
    } catch {
      // Keep the original response text.
    }

    throw new Error(
      typeof detail === 'string' ? detail : JSON.stringify(detail)
    );
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

/* -------------------- RESPONSE NORMALIZATION -------------------- */

function normalizePrediction(data, input = {}) {
  const candidates = [
    data,
    data?.data,
    data?.result,
    data?.prediction,
    data?.raw,
    data?.data?.raw,
    data?.result?.raw,
    data?.prediction?.raw,
  ].filter(
    (item) => item && typeof item === 'object' && !Array.isArray(item)
  );

  const result =
    candidates.find(
      (item) =>
        item.status === 'COMPLETED' &&
        item.flood_probability != null &&
        item.risk_level != null
    ) ||
    candidates.find(
      (item) =>
        item.flood_probability != null &&
        item.risk_level != null
    ) ||
    candidates.find(
      (item) =>
        'prediction_request_id' in item ||
        'request_id' in item
    ) ||
    candidates.find(
      (item) =>
        Array.isArray(item.missing_features) ||
        Array.isArray(item.available_features)
    ) ||
    data ||
    {};

  const missingFeatures =
    candidates.find((item) => Array.isArray(item.missing_features))
      ?.missing_features ?? [];

  const availableFeatures =
    candidates.find((item) => Array.isArray(item.available_features))
      ?.available_features ?? [];

  const rawProbability = result.flood_probability;

  const probability =
    rawProbability === null ||
    rawProbability === undefined ||
    rawProbability === ''
      ? null
      : Number(rawProbability);

  const validProbability =
    probability !== null && Number.isFinite(probability)
      ? probability
      : null;

  return {
    ...result,

    latitude:
      result.latitude ??
      result.location?.latitude ??
      input.latitude ??
      null,

    longitude:
      result.longitude ??
      result.location?.longitude ??
      input.longitude ??
      null,

    date: result.date ?? input.date ?? null,

    location_name:
      result.location_name ??
      result.location?.name ??
      input.location_name ??
      null,

    flood_probability: validProbability,
    risk_level: result.risk_level ?? null,
    flood_occurred: result.flood_occurred ?? null,
    status: result.status ?? null,
    message: result.message ?? null,

    request_id:
      result.request_id ??
      result.prediction_request_id ??
      null,

    missing_features: missingFeatures,
    available_features: availableFeatures,

    inundation: result.inundation ?? {
      available: false,
      geojson: null,
      flooded_area_km2: null,
      max_depth_m: null,
      avg_depth_m: null,
      message: 'Verified inundation geometry is not available.',
    },

    // Preserve the original API response for debugging.
    raw: data,
  };
}

/* -------------------- VALIDATION -------------------- */

function validateCoordinates(latitude, longitude) {
  if (
    latitude == null ||
    !Number.isFinite(Number(latitude)) ||
    Number(latitude) < -90 ||
    Number(latitude) > 90
  ) {
    throw new Error('Enter a valid latitude between -90 and 90.');
  }

  if (
    longitude == null ||
    !Number.isFinite(Number(longitude)) ||
    Number(longitude) < -180 ||
    Number(longitude) > 180
  ) {
    throw new Error('Enter a valid longitude between -180 and 180.');
  }
}

/* -------------------- UNAVAILABLE RESULT -------------------- */

function unavailablePrediction(params = {}) {
  return {
    id: null,
    timestamp: new Date().toISOString(),
    parameters: params,
    projectedFloodedAreaKm2: null,
    maxDepthMeters: null,
    avgDepthMeters: null,
    riskLevel: null,
    risk_level: null,
    forecastDurationHours: params?.forecastDurationHours ?? 24,
    affectedLocationsCount: null,
    highRiskAreaKm2: null,
    moderateRiskAreaKm2: null,
    lowRiskAreaKm2: null,
    predictionAvailable: false,
    message:
      'No simulated prediction was generated. Use the backend prediction API for an assessment.',
  };
}

/* -------------------- FLOOD SERVICE -------------------- */

export const floodService = {
  /**
   * Calls POST /api/predict.
   *
   * Manual environmental feature overrides are passed through
   * model_features. Weather data is still fetched by the backend.
   */
  async predictFlood({
    latitude,
    longitude,
    date,
    location_name,
    model_features = {},
  }) {
    validateCoordinates(latitude, longitude);

    if (!date) {
      throw new Error('Select a prediction date.');
    }

    if (
      model_features == null ||
      typeof model_features !== 'object' ||
      Array.isArray(model_features)
    ) {
      throw new Error('Environmental features must be an object.');
    }

    const payload = {
      latitude: Number(Number(latitude).toFixed(6)),
      longitude: Number(Number(longitude).toFixed(6)),
      date: String(date),
      ...(location_name ? { location_name } : {}),
      model_features,
    };

    console.log('[floodService] Prediction request payload:', payload);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const data = await apiRequest('/api/predict', {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      console.log('[floodService] Raw prediction response:', data);

      const normalized = normalizePrediction(data, payload);

      console.log('[floodService] Normalized prediction:', normalized);
      console.log(
        '[floodService] Missing features:',
        normalized.missing_features
      );
      console.log(
        '[floodService] Available features:',
        normalized.available_features
      );

      return normalized;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(
          'Prediction request timed out. Check the backend and try again.'
        );
      }

      if (error instanceof TypeError) {
        throw new Error(
          `Cannot reach the backend at ${API_BASE_URL}. Make sure FastAPI is running.`
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  async getPrediction(requestId) {
    if (!requestId) {
      throw new Error('A valid prediction request ID is required.');
    }

    const data = await apiRequest(
      `/api/predict/${encodeURIComponent(requestId)}`
    );

    return normalizePrediction(data);
  },

  async getPredictionHistory(limit = 50) {
    return apiRequest(
      `/api/predict/history?limit=${encodeURIComponent(limit)}`
    );
  },

  async getInundation({
    latitude,
    longitude,
    date,
    request_id,
    prediction_id,
  } = {}) {
    const query = new URLSearchParams();

    if (request_id != null) {
      query.set('request_id', String(request_id));
    }

    if (prediction_id != null) {
      query.set('prediction_id', String(prediction_id));
    }

    if (latitude != null && longitude != null) {
      query.set('latitude', String(latitude));
      query.set('longitude', String(longitude));
    }

    if (date) {
      query.set('date', String(date));
    }

    if (!query.toString()) {
      throw new Error(
        'Provide a prediction ID, request ID, or coordinates and date.'
      );
    }

    return apiRequest(`/api/inundation?${query.toString()}`);
  },

  async saveInundation(data) {
    return apiRequest('/api/inundation', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getForecast({
    location_id,
    latitude,
    longitude,
    date,
    limit = 50,
  } = {}) {
    const query = new URLSearchParams();

    if (location_id != null) {
      query.set('location_id', String(location_id));
    }

    if (latitude != null) {
      query.set('latitude', String(latitude));
    }

    if (longitude != null) {
      query.set('longitude', String(longitude));
    }

    if (date) {
      query.set('date', String(date));
    }

    query.set('limit', String(limit));

    return apiRequest(`/api/forecast?${query.toString()}`);
  },

  async createForecast(data) {
    return apiRequest('/api/forecast', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getLocations() {
    return apiRequest('/api/locations');
  },

  async reverseGeocode(latitude, longitude) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(
            latitude
          )}&lon=${encodeURIComponent(
            longitude
          )}&zoom=14&addressdetails=1`,
          {
            headers: { 'Accept-Language': 'en' },
            signal: controller.signal,
          }
        );

        if (response.ok) {
          const data = await response.json();

          if (data.display_name) {
            const address = data.address || {};
            const city =
              address.city ||
              address.town ||
              address.suburb ||
              address.village ||
              address.county ||
              address.state_district ||
              address.state;

            if (city) {
              return `${city}, ${
                address.state || address.country || ''
              }`.replace(/,\s*$/, '');
            }

            return data.display_name
              .split(',')
              .slice(0, 3)
              .join(',')
              .trim();
          }
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      // Coordinates remain usable if geocoding fails.
    }

    const closest = PRESET_LOCATIONS.find(
      (location) =>
        Math.abs(location.latitude - Number(latitude)) < 0.25 &&
        Math.abs(location.longitude - Number(longitude)) < 0.25
    );

    return (
      closest?.name ||
      `Coordinates: ${Number(latitude).toFixed(4)}, ${Number(
        longitude
      ).toFixed(4)}`
    );
  },

  async searchLocations(query) {
    const search = (query || '').trim().toLowerCase();

    const presets = search
      ? PRESET_LOCATIONS.filter(
          (location) =>
            location.name.toLowerCase().includes(search) ||
            location.region.toLowerCase().includes(search)
        )
      : [...PRESET_LOCATIONS];

    if (search.length < 2) {
      return presets;
    }

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          query
        )}&limit=6&addressdetails=1`,
        {
          headers: { 'Accept-Language': 'en' },
        }
      );

      if (response.ok) {
        const results = await response.json();

        const external = results.map((item) => ({
          name: item.display_name
            .split(',')
            .slice(0, 3)
            .join(',')
            .trim(),
          latitude: Number(item.lat),
          longitude: Number(item.lon),
          region: item.type || 'Location',
        }));

        const seen = new Set(presets.map((item) => item.name));

        external.forEach((item) => {
          if (!seen.has(item.name)) {
            presets.push(item);
            seen.add(item.name);
          }
        });
      }
    } catch {
      // Keep matching presets if geocoding is unavailable.
    }

    return presets;
  },

  /* -------------------- SUPPORTING DASHBOARD METHODS -------------------- */

  async getBasins() {
    return BASIN_LOCATIONS;
  },

  async getDashboardSummary(basinId = 'basin-krishna-lower') {
    const basin =
      BASIN_LOCATIONS.find((item) => item.id === basinId) ||
      BASIN_LOCATIONS[0];

    return {
      ...CURRENT_SUMMARY,
      locationName: basin.name,
      referenceRiver: basin.riverName,
    };
  },

  async getForecastTimeline(basinId = 'basin-krishna-lower') {
    return FORECAST_TIMELINE;
  },

  async getHydrologicalStations(basinId = 'basin-krishna-lower') {
    return HYDRO_STATIONS;
  },

  async getAffectedLocations(basinId = 'basin-krishna-lower') {
    return AFFECTED_LOCATIONS;
  },

  async getInundationLayers(horizonHours = 24) {
    const validHorizon = [1, 3, 6, 12, 24].includes(
      Number(horizonHours)
    )
      ? Number(horizonHours)
      : 24;

    return {
      horizon: validHorizon,
      riverCenterline: RIVER_CENTERLINE,
      inundationPolygons: INUNDATION_POLYGONS[validHorizon],
      settlements: SETTLEMENT_MARKERS,
      roads: ROAD_SEGMENTS,
      stations: HYDRO_STATIONS,
    };
  },

  /**
   * Legacy local calculator.
   * Retained for compatibility with older dashboard components.
   */
  async runPrediction(params = {}) {
    const baseLevel = params.forecastRiverLevel || 8.42;
    const rainFactor = (params.rainfall || 125) / 100;

    const conditionMultiplier =
      params.initialWaterCondition === 'High'
        ? 1.25
        : params.initialWaterCondition === 'Elevated'
        ? 1.1
        : 1.0;

    const estimatedArea = Number(
      Math.min(
        38.5,
        Math.max(
          5.0,
          (baseLevel * 2.2 + rainFactor * 4.5) *
            conditionMultiplier
        )
      ).toFixed(1)
    );

    const estimatedMaxDepth = Number(
      Math.min(
        4.8,
        Math.max(
          0.8,
          (baseLevel * 0.28 + rainFactor * 0.4) *
            conditionMultiplier
        )
      ).toFixed(1)
    );

    const estimatedAvgDepth = Number(
      (estimatedMaxDepth * 0.52).toFixed(1)
    );

    let riskLevel = 'LOW';

    if (estimatedMaxDepth >= 2.5 || baseLevel >= 8.5) {
      riskLevel = 'VERY_HIGH';
    } else if (estimatedMaxDepth >= 1.8 || baseLevel >= 7.8) {
      riskLevel = 'HIGH';
    } else if (estimatedMaxDepth >= 1.0 || baseLevel >= 6.5) {
      riskLevel = 'MODERATE';
    }

    const highRiskArea = Number((estimatedArea * 0.32).toFixed(1));
    const moderateRiskArea = Number((estimatedArea * 0.42).toFixed(1));
    const lowRiskArea = Number(
      (estimatedArea - highRiskArea - moderateRiskArea).toFixed(1)
    );

    return {
      id: `PRD-${Date.now().toString().slice(-6)}`,
      timestamp: new Date().toISOString(),
      parameters: params,
      projectedFloodedAreaKm2: estimatedArea,
      maxDepthMeters: estimatedMaxDepth,
      avgDepthMeters: estimatedAvgDepth,
      riskLevel,
      forecastDurationHours: params.forecastDurationHours || 24,
      affectedLocationsCount: riskLevel === 'VERY_HIGH' ? 14 : 11,
      highRiskAreaKm2: highRiskArea,
      moderateRiskAreaKm2: moderateRiskArea,
      lowRiskAreaKm2: lowRiskArea,
    };
  },

  getInitialPrediction() {
    return INITIAL_PREDICTION_RESULT;
  },
};
