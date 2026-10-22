import React, { useEffect, useState } from 'react';
import { FloodMap } from '../components/map/FloodMap.jsx';
import { MapLegend } from '../components/map/MapLegend.jsx';
import { LayerControl } from '../components/map/LayerControl.jsx';
import { floodService } from '../services/floodService.js';
import {
  Maximize2,
  Calendar,
  AlertTriangle,
  Info,
  MapPin,
  RefreshCw,
} from 'lucide-react';

export const InundationMap = ({
  basin,
  summary,
  selectedLocation,
  predictionResult,
}) => {
  const [selectedHorizon, setSelectedHorizon] = useState(24);

  const [layers, setLayers] = useState({
    showRiver: true,
    showInundation: true,
    showRiskZones: true,
    showRoads: true,
    showSettlements: true,
    showStations: true,
  });

  const [inundation, setInundation] = useState(
    predictionResult?.inundation || null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const requestId =
    predictionResult?.prediction_request_id ??
    predictionResult?.request_id ??
    null;

  const predictionId =
    predictionResult?.prediction_id ??
    predictionResult?.raw?.prediction_id ??
    null;

  const latitude = selectedLocation?.latitude ??
    predictionResult?.latitude ??
    predictionResult?.location?.latitude;

  const longitude = selectedLocation?.longitude ??
    predictionResult?.longitude ??
    predictionResult?.location?.longitude;

  const predictionDate =
    predictionResult?.date ||
    predictionResult?.prediction_date ||
    new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let cancelled = false;

    async function loadInundation() {
      const hasRequestId = requestId != null;
      const hasPredictionId = predictionId != null;
      const hasCoordinates = latitude != null && longitude != null;

      if (!hasRequestId && !hasPredictionId && !hasCoordinates) {
        setInundation(null);
        setError('');
        return;
      }

      setLoading(true);
      setError('');

      try {
        const result = await floodService.getInundation({
          request_id: requestId,
          prediction_id: predictionId,
          latitude: hasCoordinates ? latitude : undefined,
          longitude: hasCoordinates ? longitude : undefined,
          date: predictionDate,
        });

        if (cancelled) return;

        setInundation(result || null);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not load inundation data.');
          setInundation(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadInundation();

    return () => {
      cancelled = true;
    };
  }, [
    requestId,
    predictionId,
    latitude,
    longitude,
    predictionDate,
  ]);

  const mapCenter =
    latitude != null && longitude != null
      ? [Number(latitude), Number(longitude)]
      : basin?.center || [16.518, 80.62];

  const hasGeoJson = (() => {
    const geojson = inundation?.geojson;

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
  })();

  const availableArea = inundation?.flooded_area_km2;
  const availableDepth =
    inundation?.maximum_depth ?? predictionResult?.inundation?.max_depth_m;

  const formatMetric = (value, unit) =>
    typeof value === 'number' && Number.isFinite(value)
      ? `${value.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })} ${unit}`
      : 'Unavailable';

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shadow-xs">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">
              Spatial Inundation Extent Map
            </h1>

            <span className="text-xs px-2 py-0.5 rounded bg-sky-100 text-sky-800 font-semibold">
              Interactive GIS
            </span>
          </div>

          <p className="text-xs text-slate-500 mt-1">
            Displays stored geographic inundation results when valid GeoJSON
            is available.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {selectedLocation?.name && (
            <div className="flex items-center gap-1.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded px-2.5 py-1">
              <MapPin className="w-3.5 h-3.5 text-sky-700" />
              <span className="font-semibold">
                {selectedLocation.name}
              </span>
            </div>
          )}

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              Horizon:
            </span>

            {[1, 3, 6, 12, 24].map((hours) => (
              <button
                key={hours}
                onClick={() => setSelectedHorizon(hours)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  selectedHorizon === hours
                    ? 'bg-sky-700 text-white font-bold'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                }`}
              >
                +{hours}h
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              // Changing the date-independent horizon is a UI selection only.
              // Reload the current saved backend result.
              setInundation(null);
              setError('');
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-slate-200 hover:bg-slate-50"
            title="Clear the currently displayed result"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Clear result
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded shadow-xs overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 flex flex-wrap items-center justify-between text-xs gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <span className="text-slate-500">Selected horizon: </span>
              <span className="font-bold text-slate-900">
                +{selectedHorizon} hours
              </span>
            </div>

            <div>
              <span className="text-slate-500">Flooded area: </span>
              <span className="font-mono font-bold text-sky-700">
                {formatMetric(availableArea, 'km²')}
              </span>
            </div>

            <div>
              <span className="text-slate-500">Maximum depth: </span>
              <span className="font-mono font-bold text-red-700">
                {formatMetric(availableDepth, 'm')}
              </span>
            </div>
          </div>

          <span className="text-slate-500">
            {loading
              ? 'Loading backend result…'
              : hasGeoJson
                ? 'Stored geometry available'
                : 'No inundation geometry available'}
          </span>
        </div>

        <div className="relative" style={{ height: '580px' }}>
          <FloodMap
            horizonHours={selectedHorizon}
            layers={layers}
            center={mapCenter}
            zoom={latitude != null && longitude != null ? 13 : basin?.zoom || 12}
            height="580px"
            selectedLocation={
              latitude != null && longitude != null
                ? {
                    ...selectedLocation,
                    latitude: Number(latitude),
                    longitude: Number(longitude),
                  }
                : selectedLocation
            }
            predictionResult={predictionResult}
            inundationGeoJson={layers.showInundation ? inundation?.geojson : null}
            useDemoLayers={false}
          />

          {!loading && !hasGeoJson && (
            <div className="absolute top-3 left-3 z-[1000] max-w-sm rounded border border-amber-300 bg-white/95 p-3 shadow-sm">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    No flood boundary available
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    {error ||
                      inundation?.message ||
                      'The backend has not returned geographic inundation features for this selection.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {loading && (
            <div className="absolute top-3 left-3 z-[1000] rounded border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-sm">
              Loading inundation data…
            </div>
          )}

          <div className="absolute top-3 right-3 z-[1000] max-w-xs pointer-events-auto">
            <MapLegend isCompact={false} />
          </div>

          <div className="absolute bottom-3 left-3 z-[1000] pointer-events-auto">
            <LayerControl layers={layers} onChange={setLayers} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded p-3.5 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-slate-900 pb-1.5 border-b border-slate-100 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span>Risk interpretation</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            The AI model's flood-risk probability is not a map of flooded
            land. Evacuation decisions require validated local warnings and
            guidance from emergency authorities.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded p-3.5 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-slate-900 pb-1.5 border-b border-slate-100 mb-2">
            <Maximize2 className="w-4 h-4 text-sky-600" />
            <span>Spatial methodology</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            Actual inundation boundaries require a suitable GIS or
            hydrodynamic workflow using terrain elevation, water levels,
            rainfall, and other relevant data. The current prediction API
            does not generate these boundaries.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded p-3.5 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-slate-900 pb-1.5 border-b border-slate-100 mb-2">
            <Info className="w-4 h-4 text-slate-600" />
            <span>Backend connection</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            Data is requested from{' '}
            <code className="bg-slate-100 px-1 py-0.5 rounded">
              GET /api/inundation
            </code>
            . {hasGeoJson
              ? 'The response contains geographic features.'
              : 'No geographic features are currently available for display.'}
          </p>
        </div>
      </div>
    </div>
  );
};