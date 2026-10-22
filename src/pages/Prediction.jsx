
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
  Map as MapIcon,
  Navigation,
} from 'lucide-react';

const getTodayIsoDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const getOffsetIsoDate = (offsetDays) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const formatHumanDate = (dateStr) => {
  if (!dateStr) return 'Not selected';
  const date = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? dateStr
    : date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
};

const hasValidGeoJson = (geojson) => {
  if (!geojson || typeof geojson !== 'object') return false;

  if (geojson.type === 'FeatureCollection') {
    return Array.isArray(geojson.features) &&
      geojson.features.some((feature) => feature?.geometry);
  }

  if (geojson.type === 'Feature') return Boolean(geojson.geometry);

  if (geojson.type === 'GeometryCollection') {
    return Array.isArray(geojson.geometries) &&
      geojson.geometries.length > 0;
  }

  return Boolean(geojson.type && geojson.coordinates);
};

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
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [locationStatusMessage, setLocationStatusMessage] = useState('');
  const [isChangingLocation, setIsChangingLocation] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [predictionError, setPredictionError] = useState('');
  const [formValidationMessage, setFormValidationMessage] = useState('');

  const searchInputRef = useRef(null);
  const hasRequestedGeolocation = useRef(false);

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
      setLocationStatusMessage('This browser does not support geolocation.');
      return;
    }

    setIsLocating(true);
    setLocationPermissionDenied(false);
    setLocationStatusMessage('Acquiring GPS coordinates...');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = Number(position.coords.latitude.toFixed(6));
        const longitude = Number(position.coords.longitude.toFixed(6));

        let name = `Current Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;

        try {
          name = await floodService.reverseGeocode(latitude, longitude) || name;
        } catch {
          // Coordinates remain usable without reverse geocoding.
        }

        setSelectedLocation?.({
          name,
          latitude,
          longitude,
          isCurrentLocation: true,
        });

        setLocationStatusMessage('Current location selected.');
        setIsChangingLocation(false);
        setIsLocating(false);
      },
      (error) => {
        setIsLocating(false);

        if (error.code === 1) {
          setLocationPermissionDenied(true);
          setLocationStatusMessage('Location permission denied. Search for a location manually.');
        } else if (error.code === 2) {
          setLocationStatusMessage('Location is unavailable. Try searching for a city.');
        } else if (error.code === 3) {
          setLocationStatusMessage('GPS request timed out. Try again or search manually.');
        } else {
          setLocationStatusMessage('Could not retrieve your location.');
        }

        if (!selectedLocation) setIsChangingLocation(true);
      },
      {
        timeout: 10000,
        enableHighAccuracy: false,
        maximumAge: 60000,
      }
    );
  }, [setSelectedLocation, selectedLocation]);

  useEffect(() => {
    if (hasRequestedGeolocation.current) return;
    hasRequestedGeolocation.current = true;

    // Request location when the prediction page first opens.
    handleUseCurrentLocation();
  }, [handleUseCurrentLocation]);

  useEffect(() => {
    if (isChangingLocation) searchInputRef.current?.focus();
  }, [isChangingLocation]);

  const handleSearchChange = async (event) => {
    const value = event.target.value;
    setSearchQuery(value);

    if (value.trim().length < 2) {
      setSearchResults(PRESET_LOCATIONS.slice(0, 8));
      return;
    }

    setIsSearching(true);

    try {
      const results = await floodService.searchLocations(value);
      setSearchResults(results);
    } catch {
      setSearchResults(
        PRESET_LOCATIONS.filter((location) =>
          location.name.toLowerCase().includes(value.toLowerCase())
        )
      );
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectLocation = (location) => {
    setSelectedLocation?.({
      name: location.name,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      isCurrentLocation: false,
    });

    setSearchQuery('');
    setIsChangingLocation(false);
    setLocationStatusMessage('');
    setLocationPermissionDenied(false);
    setFormValidationMessage('');
    setPredictionError('');
  };

  const handlePredictFlood = async (event) => {
    event.preventDefault();
    setFormValidationMessage('');
    setPredictionError('');

    if (
      !selectedLocation ||
      selectedLocation.latitude == null ||
      selectedLocation.longitude == null
    ) {
      setFormValidationMessage('Please select a valid location.');
      return;
    }

    if (!selectedDate) {
      setFormValidationMessage('Please select a prediction date.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await floodService.predictFlood({
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude,
        date: selectedDate,
        location_name: selectedLocation.name,
      });

      setPredictionResult?.({
        ...response,
        locationName: selectedLocation.name,
        location_name: selectedLocation.name,
      });
    } catch (error) {
      setPredictionError(
        error.message || 'Prediction service is currently unavailable.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setPredictionError('');
    setFormValidationMessage('');
    setPredictionResult?.(null);
    setSelectedDate?.(getTodayIsoDate());
  };

  const result = predictionResult;
  const probability = result?.flood_probability;
  const validProbability =
    typeof probability === 'number' &&
    Number.isFinite(probability) &&
    probability >= 0 &&
    probability <= 1;

  const status = String(result?.status || '').toUpperCase();

  const completed =
    status === 'COMPLETED' && validProbability;

  const pending = [
    'PENDING',
    'WAITING_FOR_AI_MODEL',
    'PENDING_AI_MODEL',
    'PROCESSING',
  ].includes(status);

  const validGeoJson = hasValidGeoJson(result?.inundation?.geojson);

  const mapCenter =
    selectedLocation?.latitude != null &&
    selectedLocation?.longitude != null
      ? [Number(selectedLocation.latitude), Number(selectedLocation.longitude)]
      : [16.518, 80.62];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Flood Inundation Projection
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Select a location and date to request an experimental flood-risk prediction.
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-600">
          <div className="flex items-center gap-1.5 bg-slate-50 border rounded px-2.5 py-1.5">
            <CalendarIcon className="w-3.5 h-3.5" />
            Today: {getTodayIsoDate()}
          </div>
          <button
            type="button"
            onClick={handleReset}
            disabled={isLoading}
            title="Reset prediction form"
            className="p-2 rounded border hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <section className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <MapPin className="w-4 h-4 text-sky-700" />
                Location
              </span>
              {selectedLocation?.isCurrentLocation && (
                <span className="text-xs text-emerald-700">Current GPS</span>
              )}
            </div>

            {isLocating && (
              <p className="text-xs text-sky-700 mb-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Acquiring location...
              </p>
            )}

            {locationStatusMessage && (
              <p className="text-xs text-slate-600 mb-3">
                {locationStatusMessage}
              </p>
            )}

            {locationPermissionDenied && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded mb-3">
                GPS access was denied. Select a location manually.
              </p>
            )}

            {!isChangingLocation && selectedLocation && (
              <div className="py-2">
                <p className="font-bold text-slate-900">
                  {selectedLocation.name}
                </p>
                <p className="text-xs text-slate-500 font-mono mt-2">
                  Lat: {Number(selectedLocation.latitude).toFixed(5)} · Long:{' '}
                  {Number(selectedLocation.longitude).toFixed(5)}
                </p>
              </div>
            )}

            {isChangingLocation && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleUseCurrentLocation}
                  disabled={isLocating}
                  className="w-full py-2.5 rounded border border-sky-300 bg-sky-50 text-sky-800 text-sm font-semibold disabled:opacity-50"
                >
                  <Navigation className="inline w-4 h-4 mr-2" />
                  Use Current Location
                </button>

                <div className="relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={handleSearchChange}
                    placeholder="Search city or district"
                    className="w-full border rounded pl-9 pr-3 py-2.5 text-sm"
                  />
                  {isSearching && (
                    <Loader2 className="absolute right-3 top-3 w-4 h-4 animate-spin" />
                  )}
                </div>

                <div className="max-h-48 overflow-y-auto border rounded divide-y">
                  {(searchResults.length
                    ? searchResults
                    : PRESET_LOCATIONS.slice(0, 8)
                  ).map((location, index) => (
                    <button
                      type="button"
                      key={`${location.name}-${index}`}
                      onClick={() => handleSelectLocation(location)}
                      className="block w-full text-left p-3 hover:bg-sky-50"
                    >
                      <span className="block text-sm font-medium">
                        {location.name}
                      </span>
                      <span className="text-xs text-slate-500">
                        {location.latitude}, {location.longitude}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 pt-3 border-t">
              {!isChangingLocation ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsChangingLocation(true);
                    setSearchResults(PRESET_LOCATIONS.slice(0, 8));
                  }}
                  className="w-full py-2 border rounded text-sm font-semibold hover:bg-slate-50"
                >
                  Change Location
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsChangingLocation(false)}
                  className="w-full py-2 border rounded text-sm"
                >
                  Cancel
                </button>
              )}
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-sky-700" />
                Prediction Date
              </span>
            </div>

            <p className="font-bold text-slate-900">
              {formatHumanDate(selectedDate)}
            </p>

            <input
              type="date"
              value={selectedDate || getTodayIsoDate()}
              onChange={(event) => setSelectedDate?.(event.target.value)}
              className="mt-4 w-full border rounded px-3 py-2.5 text-sm"
            />

            <div className="flex flex-wrap gap-2 mt-3">
              {[
                { label: 'Today', date: getTodayIsoDate() },
                { label: '+1 Day', date: getOffsetIsoDate(1) },
                { label: '+3 Days', date: getOffsetIsoDate(3) },
                { label: '+7 Days', date: getOffsetIsoDate(7) },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setSelectedDate?.(item.date)}
                  className={`text-xs px-3 py-1.5 border rounded ${
                    selectedDate === item.date
                      ? 'bg-sky-100 border-sky-300 text-sky-800'
                      : 'bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <p className="text-xs text-slate-500 mt-4">
              The selected date is sent to the backend. Forecast accuracy depends
              on available input data and model validation.
            </p>
          </section>
        </div>

        {formValidationMessage && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
            <AlertTriangle className="inline w-4 h-4 mr-2" />
            {formValidationMessage}
          </div>
        )}

        <div className="flex justify-center">
          <button
            type="button"
            onClick={handlePredictFlood}
            disabled={isLoading}
            className="w-full sm:w-auto min-w-64 px-8 py-3.5 bg-sky-700 hover:bg-sky-800 text-white rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Running Prediction...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Predict Flood
              </>
            )}
          </button>
        </div>

        <p className="text-center text-xs text-slate-500">
          POST /api/predict
        </p>
      </div>

      {predictionError && (
        <div className="p-5 bg-red-50 border border-red-200 rounded-lg text-red-900">
          <div className="font-bold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Prediction Service Error
          </div>
          <p className="text-sm mt-2">{predictionError}</p>
          <p className="text-xs mt-2">
            Verify that FastAPI is running at{' '}
            {import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'}.
          </p>
        </div>
      )}

      {result && !predictionError && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-3 border-b pb-3">
            {completed ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            )}
            <div>
              <h2 className="font-bold text-slate-900">
                Flood Prediction Result
              </h2>
              <p className="text-xs text-slate-500">
                {result.locationName || result.location_name || selectedLocation?.name}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 bg-slate-50 border rounded-lg">
              <p className="text-xs text-slate-500 uppercase font-bold">Location</p>
              <p className="font-semibold mt-2 break-words">
                {result.locationName || result.location_name || result.location?.name || 'Unknown'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {result.latitude ?? result.location?.latitude ?? selectedLocation?.latitude},
                {' '}
                {result.longitude ?? result.location?.longitude ?? selectedLocation?.longitude}
              </p>
            </div>

            <div className="p-4 bg-slate-50 border rounded-lg">
              <p className="text-xs text-slate-500 uppercase font-bold">Prediction Date</p>
              <p className="font-semibold mt-2">
                {formatHumanDate(result.date || selectedDate)}
              </p>
            </div>

            <div className="p-4 bg-slate-50 border rounded-lg">
              <p className="text-xs text-slate-500 uppercase font-bold">Flood Probability</p>
              <p className="text-2xl font-black text-sky-800 mt-2">
                {validProbability
                  ? `${(probability * 100).toFixed(1)}%`
                  : 'Unavailable'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Experimental model output
              </p>
            </div>

            <div className="p-4 bg-slate-50 border rounded-lg">
              <p className="text-xs text-slate-500 uppercase font-bold">Model Risk Level</p>
              <div className="mt-2">
                {validProbability && result.risk_level ? (
                  <RiskBadge level={result.risk_level} size="lg" />
                ) : (
                  <span className="text-sm font-semibold text-slate-500">
                    Unavailable
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className={`p-4 rounded-lg border ${
            completed
              ? 'bg-sky-50 border-sky-200'
              : 'bg-amber-50 border-amber-200'
          }`}>
            <p className="font-bold text-sm">
              {completed
                ? 'Prediction Completed'
                : pending
                  ? 'Prediction Pending'
                  : 'Prediction Incomplete'}
            </p>
            <p className="text-sm mt-1">
              {completed
                ? 'The backend returned a model probability. The model was trained on synthetic data, so this result is experimental and is not a validated real-world flood warning.'
                : result.message ||
                  'A complete model prediction is not available. Check the backend response and required input features.'}
            </p>
            <p className="text-xs font-mono mt-2">
              Status: {result.status || 'UNKNOWN'}
              {result.prediction_request_id != null &&
                ` · Request ID: ${result.prediction_request_id}`}
            </p>
          </div>

          <div className="text-xs text-slate-600 border-t pt-3">
            <strong>GIS status:</strong>{' '}
            {validGeoJson
              ? 'Backend GeoJSON features are available.'
              : 'No actual inundation geometry is available for this prediction.'}
          </div>
        </section>
      )}

      {!result && !predictionError && !isLoading && (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center">
          <Compass className="w-8 h-8 text-sky-700 mx-auto mb-3" />
          <h3 className="font-bold text-slate-800">No Prediction Generated Yet</h3>
          <p className="text-sm text-slate-500 mt-2">
            Select a location and date, then click Predict Flood.
          </p>
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b flex items-center gap-3">
          <MapIcon className="w-5 h-5 text-sky-700" />
          <div>
            <h3 className="font-bold text-sm text-slate-900">
              GIS Inundation & Spatial Risk Map
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Displays the selected location and any available backend GeoJSON.
            </p>
          </div>
        </div>

        <div className="relative w-full h-[520px]">
          <FloodMap
            selectedLocation={selectedLocation}
            predictionResult={result}
            inundationGeoJson={mapLayers.showInundation ? result?.inundation?.geojson : null}
            center={mapCenter}
            zoom={selectedLocation ? 13 : 11}
            layers={mapLayers}
            height="100%"
            useDemoLayers={false}
          />

          {!validGeoJson && (
            <div className="absolute top-3 left-3 z-[1000] max-w-xs bg-white/95 border border-amber-200 rounded-lg p-3 shadow-sm">
              <p className="text-xs font-semibold text-slate-900">
                Inundation boundary unavailable
              </p>
              <p className="text-xs text-slate-600 mt-1">
                The model's probability does not itself generate a geographic
                flood boundary.
              </p>
            </div>
          )}

          <div className="absolute top-3 right-3 z-[1000] max-w-xs">
            <MapLegend isCompact={true} />
          </div>

          <div className="absolute bottom-3 left-3 z-[1000]">
            <LayerControl layers={mapLayers} onChange={setMapLayers} />
          </div>
        </div>
      </section>
    </div>
  );
};

export default Prediction;
