
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { floodService, PRESET_LOCATIONS } from '../services/floodService.js';
import { RiskBadge } from '../components/common/RiskBadge.jsx';
import { FloodMap } from '../components/map/FloodMap.jsx';
import { MapLegend } from '../components/map/MapLegend.jsx';
import { LayerControl } from '../components/map/LayerControl.jsx';
import {
  MapPin,
  Calendar as CalendarIcon,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Search,
  Compass,
  Loader2,
  ShieldAlert,
  HelpCircle,
  Map as MapIcon,
  Navigation,
} from 'lucide-react';

const getTodayIsoDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getOffsetIsoDate = (offsetDays) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const formatHumanDate = (dateStr) => {
  if (!dateStr) return '';

  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;

  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

const FEATURE_DETAILS = {
  catchment_area_km2: {
    label: 'Catchment Area',
    unit: 'km²',
    hint: 'Use a measured or officially reported value.',
  },
  elevation_m: { label: 'Elevation', unit: 'm' },
  rainfall_1h_mm: { label: 'Rainfall — Last 1 Hour', unit: 'mm' },
  rainfall_3h_mm: { label: 'Rainfall — Last 3 Hours', unit: 'mm' },
  rainfall_6h_mm: { label: 'Rainfall — Last 6 Hours', unit: 'mm' },
  rainfall_24h_mm: { label: 'Rainfall — Last 24 Hours', unit: 'mm' },
  antecedent_rainfall_3d_mm: {
    label: 'Antecedent Rainfall — 3 Days',
    unit: 'mm',
  },
  soil_moisture_pct: { label: 'Soil Moisture', unit: '%' },
  upstream_level_change_3h_m: {
    label: 'Upstream Water-Level Change',
    unit: 'm / 3 hours',
  },
  river_water_level_m: { label: 'River Water Level', unit: 'm' },
  river_discharge_m3s: { label: 'River Discharge', unit: 'm³/s' },
  reservoir_release_m3s: { label: 'Reservoir Release', unit: 'm³/s' },
  slope_deg: { label: 'Terrain Slope', unit: 'degrees' },
  drainage_density_km_per_km2: {
    label: 'Drainage Density',
    unit: 'km/km²',
  },
  land_use: {
    label: 'Land Use',
    unit: '',
    hint: 'Enter a category supported by the model training data.',
  },
  impervious_surface_pct: { label: 'Impervious Surface', unit: '%' },
  tide_level_m: { label: 'Tide Level', unit: 'm' },
};

const RISK_LEVELS = ['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH'];

export const Prediction = ({
  onNavigate,
  selectedLocation,
  setSelectedLocation,
  selectedDate,
  setSelectedDate,
  predictionResult,
  setPredictionResult,
}) => {
  const [isLocating, setIsLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [locationError, setLocationError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isChangingLocation, setIsChangingLocation] = useState(false);

  const searchInputRef = useRef(null);
  const hasRequestedGeolocation = useRef(false);

  const [isLoading, setIsLoading] = useState(false);
  const [predictionError, setPredictionError] = useState(null);
  const [formValidationMessage, setFormValidationMessage] = useState('');
  const [missingFeatures, setMissingFeatures] = useState([]);
  const [manualFeatureValues, setManualFeatureValues] = useState({});

  const [mapLayers, setMapLayers] = useState({
    showRiver: true,
    showInundation: true,
    showRiskZones: true,
    showRoads: false,
    showSettlements: true,
    showStations: true,
  });

  const handleUseCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('This browser does not support geolocation.');
      return;
    }

    setIsLocating(true);
    setLocationError('');
    setLocationMessage('Acquiring GPS coordinates...');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = Number(position.coords.latitude.toFixed(6));
        const longitude = Number(position.coords.longitude.toFixed(6));

        let name = `Current Location (${latitude}, ${longitude})`;

        try {
          const result = await floodService.reverseGeocode(
            latitude,
            longitude
          );

          if (result) name = result;
        } catch {
          // Coordinates remain usable if reverse geocoding is unavailable.
        }

        setSelectedLocation?.({
          name,
          latitude,
          longitude,
          isCurrentLocation: true,
        });

        setLocationMessage('Location selected successfully.');
        setIsChangingLocation(false);
        setIsLocating(false);
      },
      (error) => {
        setIsLocating(false);
        setLocationMessage('');

        if (error.code === error.PERMISSION_DENIED) {
          setLocationError(
            'Location permission denied. Search for a location instead.'
          );
        } else if (error.code === error.TIMEOUT) {
          setLocationError('Location request timed out. Please try again.');
        } else {
          setLocationError('Unable to retrieve your location.');
        }
      },
      {
        timeout: 10000,
        enableHighAccuracy: false,
        maximumAge: 60000,
      }
    );
  }, [setSelectedLocation]);

  useEffect(() => {
    if (!hasRequestedGeolocation.current) {
      hasRequestedGeolocation.current = true;
      handleUseCurrentLocation();
    }
  }, [handleUseCurrentLocation]);

  useEffect(() => {
    if (isChangingLocation) {
      searchInputRef.current?.focus();
    }
  }, [isChangingLocation]);

  const handleSearchChange = async (event) => {
    const query = event.target.value;

    setSearchQuery(query);
    setFormValidationMessage('');

    if (query.trim().length < 2) {
      setSearchResults(PRESET_LOCATIONS.slice(0, 8));
      return;
    }

    setIsSearching(true);

    try {
      const results = await floodService.searchLocations(query);
      setSearchResults(Array.isArray(results) ? results : []);
    } catch {
      setSearchResults(PRESET_LOCATIONS);
    } finally {
      setIsSearching(false);
    }
  };

  
const handlePredictFlood = async (event) => {
  event?.preventDefault();

  setFormValidationMessage('');
  setPredictionError(null);

  // 1. Validate location
  if (
    !selectedLocation ||
    selectedLocation.latitude == null ||
    selectedLocation.longitude == null ||
    !Number.isFinite(Number(selectedLocation.latitude)) ||
    !Number.isFinite(Number(selectedLocation.longitude))
  ) {
    setFormValidationMessage('Please select a valid location.');
    return;
  }

  // 2. Validate date
  if (!selectedDate) {
    setFormValidationMessage('Please select a prediction date.');
    return;
  }

  // 3. Ensure all requested missing features are filled
  const emptyFields = missingFeatures.filter((feature) => {
    const value = manualFeatureValues[feature];

    return (
      value === undefined ||
      value === null ||
      String(value).trim() === ''
    );
  });

  if (emptyFields.length > 0) {
    setFormValidationMessage(
      `Please complete: ${emptyFields
        .map((feature) => FEATURE_DETAILS[feature]?.label || feature)
        .join(', ')}`
    );
    return;
  }

  // 4. Prepare every populated manual feature for the backend
  const modelFeatures = {};

  for (const [feature, rawValue] of Object.entries(manualFeatureValues)) {
    if (
      rawValue === undefined ||
      rawValue === null ||
      String(rawValue).trim() === ''
    ) {
      continue;
    }

    if (feature === 'land_use') {
      modelFeatures[feature] = String(rawValue).trim();
      continue;
    }

    const value = Number(rawValue);

    if (!Number.isFinite(value)) {
      setFormValidationMessage(
        `${FEATURE_DETAILS[feature]?.label || feature} must be a valid number.`
      );
      return;
    }

    if (
      ['soil_moisture_pct', 'impervious_surface_pct'].includes(feature) &&
      (value < 0 || value > 100)
    ) {
      setFormValidationMessage(
        `${FEATURE_DETAILS[feature]?.label || feature} must be between 0 and 100.`
      );
      return;
    }

    modelFeatures[feature] = value;
  }

  // 5. Build and log the exact request
  const requestPayload = {
    latitude: Number(selectedLocation.latitude),
    longitude: Number(selectedLocation.longitude),
    date: selectedDate,
    location_name: selectedLocation.name,
    model_features: modelFeatures,
  };

  console.log(
    '[Prediction] Request payload:',
    JSON.stringify(requestPayload, null, 2)
  );

  setIsLoading(true);

  try {
    // 6. Send request to FastAPI
    const response = await floodService.predictFlood(requestPayload);

    console.log(
      '[Prediction] Full response:',
      JSON.stringify(response, null, 2)
    );

    // 7. Update missing fields returned by the backend
    const returnedMissing = Array.isArray(response.missing_features)
      ? response.missing_features
      : [];

    setMissingFeatures(returnedMissing);

    // Preserve values already entered by the user
    setManualFeatureValues((previous) => {
      const next = { ...previous };

      returnedMissing.forEach((feature) => {
        if (!(feature in next)) {
          next[feature] = '';
        }
      });

      return next;
    });

    // 8. Update the prediction result
    if (setPredictionResult) {
      setPredictionResult({
        ...response,
        locationName: selectedLocation.name,
      });
    }

    // 9. Tell the user what remains to be done
    if (returnedMissing.length > 0) {
      setFormValidationMessage(
        `The backend still requires: ${returnedMissing
          .map((feature) => FEATURE_DETAILS[feature]?.label || feature)
          .join(', ')}.`
      );
    } else {
      setFormValidationMessage('');
    }
  } catch (error) {
    console.error('[Prediction] Request failed:', error);

    setPredictionError(
      error.message || 'Prediction service is currently unavailable.'
    );
  } finally {
    setIsLoading(false);
  }
};


  const handleReset = () => {
    setPredictionError(null);
    setFormValidationMessage('');
    setMissingFeatures([]);
    setManualFeatureValues({});
    setPredictionResult?.(null);
    setSelectedDate?.(getTodayIsoDate());
  };

  const hasResult = Boolean(predictionResult);

  const hasValidRisk =
    typeof predictionResult?.flood_probability === 'number' &&
    RISK_LEVELS.includes(predictionResult?.risk_level);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Flood Inundation Projection
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Select a location and date to assess available environmental data
            with the experimental AI model.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Today: {formatHumanDate(getTodayIsoDate())}
          </span>

          <button
            type="button"
            onClick={handleReset}
            disabled={isLoading}
            className="rounded border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            title="Reset prediction"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </header>

      <section className="space-y-5 rounded-xl border border-slate-200 bg-slate-50/70 p-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <MapPin className="h-4 w-4 text-sky-700" />
              LOCATION
            </h2>

            {selectedLocation ? (
              <div>
                <p className="font-semibold text-slate-900">
                  {selectedLocation.name}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Latitude: {Number(selectedLocation.latitude).toFixed(5)}
                  {' · '}
                  Longitude: {Number(selectedLocation.longitude).toFixed(5)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No location selected yet.
              </p>
            )}

            {locationMessage && (
              <p className="text-xs text-emerald-700">{locationMessage}</p>
            )}

            {locationError && (
              <p className="text-xs text-amber-700">{locationError}</p>
            )}

            <button
              type="button"
              onClick={handleUseCurrentLocation}
              disabled={isLocating}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2.5 text-sm font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50"
            >
              {isLocating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Navigation className="h-4 w-4" />
              )}
              Use Current Location
            </button>

            <button
              type="button"
              onClick={() => {
                setIsChangingLocation((previous) => !previous);
                setSearchResults(PRESET_LOCATIONS.slice(0, 8));
              }}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {isChangingLocation
                ? 'Close Location Search'
                : 'Search Location'}
            </button>

            {isChangingLocation && (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />

                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={handleSearchChange}
                    placeholder="Search city, district or region"
                    className="w-full rounded-md border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:border-sky-600 focus:outline-none"
                  />

                  {isSearching && (
                    <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-slate-400" />
                  )}
                </div>

                <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white">
                  {searchResults.map((location, index) => (
                    <button
                      type="button"
                      key={`${location.name}-${index}`}
                      onClick={() => handleSelectLocation(location)}
                      className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-sky-50"
                    >
                      <span className="font-medium">{location.name}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {location.latitude}, {location.longitude}
                      </span>
                    </button>
                  ))}

                  {!searchResults.length && (
                    <p className="p-3 text-xs text-slate-500">
                      No matching locations. Try another search.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <CalendarIcon className="h-4 w-4 text-sky-700" />
              PREDICTION DATE
            </h2>

            <p className="text-lg font-bold text-slate-900">
              {formatHumanDate(selectedDate)}
            </p>

            <input
              type="date"
              value={selectedDate || getTodayIsoDate()}
              onChange={(event) => {
                setSelectedDate?.(event.target.value);
                setFormValidationMessage('');
              }}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-sky-600 focus:outline-none"
            />

            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Today', date: getTodayIsoDate() },
                { label: '+1 Day', date: getOffsetIsoDate(1) },
                { label: '+3 Days', date: getOffsetIsoDate(3) },
                { label: '+7 Days', date: getOffsetIsoDate(7) },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setSelectedDate?.(item.date);
                    setFormValidationMessage('');
                  }}
                  className={`rounded border px-2.5 py-1.5 text-xs ${
                    selectedDate === item.date
                      ? 'border-sky-300 bg-sky-100 font-semibold text-sky-800'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <p className="text-xs text-slate-500">
              The selected date does not guarantee that weather or river
              measurements are available for that date.
            </p>
          </div>
        </div>

        {missingFeatures.length > 0 && (
          <div className="space-y-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <div>
              <h2 className="text-sm font-bold text-amber-900">
                Additional Environmental Data Required
              </h2>
              <p className="mt-1 text-xs text-amber-800">
                Provide reliable measurements for the missing model features.
                Leave a field blank if you do not know its value.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {missingFeatures.map((feature) => {
                const details = FEATURE_DETAILS[feature];

                if (!details) {
                  return (
                    <p key={feature} className="text-xs text-red-700">
                      Unsupported model feature: {feature}
                    </p>
                  );
                }

                return (
                  <div key={feature}>
                    <label
                      htmlFor={`feature-${feature}`}
                      className="mb-1.5 block text-xs font-semibold text-slate-800"
                    >
                      {details.label}
                      {details.unit ? ` (${details.unit})` : ''}
                    </label>

                    <input
                      id={`feature-${feature}`}
                      type={feature === 'land_use' ? 'text' : 'number'}
                      step={feature === 'land_use' ? undefined : 'any'}
                      value={manualFeatureValues[feature] ?? ''}
                      onChange={(event) =>
                        setManualFeatureValues((previous) => ({
                          ...previous,
                          [feature]: event.target.value,
                        }))
                      }
                      placeholder={`Enter ${details.label.toLowerCase()}`}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-sky-600 focus:outline-none"
                    />

                    {details.hint && (
                      <p className="mt-1 text-xs text-slate-600">
                        {details.hint}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {formValidationMessage && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {formValidationMessage}
          </div>
        )}

        <div className="flex justify-center">
          <button
            type="button"
            onClick={handlePredictFlood}
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-700 px-8 py-3.5 text-sm font-bold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking environmental data...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Predict Flood
              </>
            )}
          </button>
        </div>
      </section>

      {predictionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="flex items-center gap-2 font-bold">
            <AlertTriangle className="h-4 w-4" />
            Prediction Service Unavailable
          </div>
          <p className="mt-2">{predictionError}</p>
          <p className="mt-2 text-xs">
            Verify that the FastAPI backend is running at{' '}
            {import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}.
          </p>
        </div>
      )}

      {hasResult && !predictionError && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div>
              <h2 className="font-bold text-slate-900">
                Flood Prediction Result
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {predictionResult.locationName || selectedLocation?.name}
              </p>
            </div>

            <span className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
              {predictionResult.status || 'Response received'}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Location
              </p>
              <p className="mt-2 break-words text-sm font-bold text-slate-900">
                {predictionResult.locationName ||
                  selectedLocation?.name ||
                  'Unknown'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {predictionResult.latitude ?? selectedLocation?.latitude}
                {' '}
                {', '}
                {predictionResult.longitude ?? selectedLocation?.longitude}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Prediction Date
              </p>
              <p className="mt-2 text-sm font-bold text-slate-900">
                {formatHumanDate(predictionResult.date || selectedDate)}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Flood Probability
              </p>
              <p className="mt-2 text-2xl font-black text-sky-800">
                {typeof predictionResult.flood_probability === 'number'
                  ? `${(predictionResult.flood_probability * 100).toFixed(2)}%`
                  : 'Not assessed'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {typeof predictionResult.flood_probability === 'number'
                  ? 'Experimental AI model output'
                  : 'Required environmental data is unavailable'}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Risk Level
              </p>
              <div className="mt-2">
                {hasValidRisk ? (
                  <RiskBadge level={predictionResult.risk_level} size="lg" />
                ) : (
                  <span className="inline-block rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-sm font-bold text-amber-800">
                    NOT ASSESSED
                  </span>
                )}
              </div>
            </div>
          </div>

          <div
            role="status"
            aria-live="polite"
            className={`flex items-start gap-3 rounded-lg border p-4 ${
              !hasValidRisk
                ? 'border-amber-200 bg-amber-50 text-amber-950'
                : predictionResult.flood_occurred
                  ? 'border-red-200 bg-red-50 text-red-900'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
          >
            {!hasValidRisk ? (
              <HelpCircle className="mt-0.5 h-5 w-5 shrink-0" />
            ) : predictionResult.flood_occurred ? (
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            )}

            <div>
              <p className="text-sm font-bold">
                {!hasValidRisk
                  ? 'Prediction unavailable — risk not assessed'
                  : `Experimental Model Result: ${predictionResult.risk_level} Risk`}
              </p>
              <p className="mt-1 text-xs">
                {predictionResult.message ||
                  'This model was trained on synthetic data and is not a validated real-world flood warning system.'}
              </p>
            </div>
          </div>

          {missingFeatures.length > 0 && (
            <p className="text-sm text-amber-800">
              Additional inputs are required. Complete the environmental-data
              fields above and request a prediction again.
            </p>
          )}
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
          <MapIcon className="h-5 w-5 text-sky-700" />
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              GIS Inundation & Spatial Risk Map
            </h2>
            <p className="text-xs text-slate-500">
              Map layers are visualizations; they do not independently validate
              a flood prediction.
            </p>
          </div>
        </div>

        <div className="relative h-[520px] w-full">
          <FloodMap
            selectedLocation={selectedLocation}
            predictionResult={predictionResult}
            inundationGeoJson={predictionResult?.inundation?.geojson}
            center={
              selectedLocation?.latitude != null &&
              selectedLocation?.longitude != null
                ? [
                    Number(selectedLocation.latitude),
                    Number(selectedLocation.longitude),
                  ]
                : [16.518, 80.62]
            }
            zoom={selectedLocation ? 13 : 11}
            layers={mapLayers}
            height="100%"
          />

          <div className="absolute right-3 top-3 z-[1000] max-w-xs">
            <MapLegend isCompact />
          </div>

          <div className="absolute bottom-3 left-3 z-[1000]">
            <LayerControl layers={mapLayers} onChange={setMapLayers} />
          </div>
        </div>
      </section>

      {!hasResult && !predictionError && !isLoading && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <Compass className="mx-auto mb-3 h-8 w-8 text-sky-700" />
          <h2 className="font-bold text-slate-800">
            No Prediction Generated Yet
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
            Select a location and date, then choose Predict Flood. If
            environmental features are missing, the backend should return
            the list of required fields.
          </p>
        </div>
      )}
    </div>
  );
};

export default Prediction;
