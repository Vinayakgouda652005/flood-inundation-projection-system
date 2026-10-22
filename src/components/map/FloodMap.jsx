import React, { useEffect, useMemo } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  TileLayer,
  Polyline,
  Polygon,
  CircleMarker,
  Popup,
  Tooltip,
  useMap,
  GeoJSON,
  Marker,
} from 'react-leaflet';

import {
  RIVER_CENTERLINE,
  INUNDATION_POLYGONS,
  SETTLEMENT_MARKERS,
  ROAD_SEGMENTS,
  HYDRO_STATIONS,
} from '../../data/mockData.js';

const MapEffectController = ({ center, zoom }) => {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(timer);
  }, [map]);

  useEffect(() => {
    if (
      Array.isArray(center) &&
      center.length === 2 &&
      center.every((value) => Number.isFinite(Number(value)))
    ) {
      map.setView(center, zoom || map.getZoom(), { animate: true });
    }
  }, [center, zoom, map]);

  return null;
};

function hasGeoJsonGeometry(data) {
  if (!data || typeof data !== 'object') return false;

  if (data.type === 'FeatureCollection') {
    return Array.isArray(data.features) &&
      data.features.some((feature) => feature?.geometry);
  }

  if (data.type === 'Feature') {
    return Boolean(data.geometry);
  }

  return Boolean(data.type && data.coordinates) ||
    (data.type === 'GeometryCollection' &&
      Array.isArray(data.geometries) &&
      data.geometries.length > 0);
}

const createSelectedLocationIcon = (isHighRisk = false) => {
  const background = isHighRisk ? '#dc2626' : '#0284c7';
  const pulse = isHighRisk
    ? 'rgba(239,68,68,0.35)'
    : 'rgba(14,165,233,0.35)';

  return L.divIcon({
    className: 'selected-location-pin',
    html: `
      <div style="position:relative;display:flex;align-items:center;justify-content:center;width:44px;height:44px">
        <span style="position:absolute;width:40px;height:40px;border-radius:50%;background:${pulse};animation:ping 1.4s cubic-bezier(0,0,0.2,1) infinite"></span>
        <div style="position:relative;z-index:2;width:34px;height:34px;border-radius:50%;background:${background};border:3px solid white;box-shadow:0 4px 10px #0005;display:flex;align-items:center;justify-content:center;color:white">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
            <circle cx="12" cy="10" r="3" fill="white"></circle>
          </svg>
        </div>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 40],
    popupAnchor: [0, -36],
  });
};

export const FloodMap = ({
  horizonHours = 24,
  layers = {
    showRiver: true,
    showInundation: false,
    showRiskZones: false,
    showRoads: true,
    showSettlements: true,
    showStations: true,
  },
  center = [16.518, 80.620],
  zoom = 12,
  height = '100%',
  interactive = true,
  selectedLocation = null,
  predictionResult = null,
  inundationGeoJson = null,
  useDemoLayers = false,
}) => {
  const validHorizon = [1, 3, 6, 12, 24].includes(horizonHours)
    ? horizonHours
    : 24;

  const demoPolygons = INUNDATION_POLYGONS[validHorizon] ||
    INUNDATION_POLYGONS[24];

  const effectiveCenter =
    selectedLocation?.latitude != null &&
    selectedLocation?.longitude != null
      ? [Number(selectedLocation.latitude), Number(selectedLocation.longitude)]
      : center;

  const isHighRisk = ['HIGH', 'VERY_HIGH'].includes(
    String(predictionResult?.risk_level || '').toUpperCase()
  );

  const validGeoJson = useMemo(
    () => hasGeoJsonGeometry(inundationGeoJson),
    [inundationGeoJson]
  );

  const showDemo = useDemoLayers && !validGeoJson;

  return (
    <div
      className="relative w-full overflow-hidden rounded border border-slate-300 bg-slate-100"
      style={{ height }}
    >
      <MapContainer
        center={effectiveCenter}
        zoom={zoom}
        scrollWheelZoom={interactive}
        dragging={interactive}
        zoomControl={interactive}
        className="h-full w-full"
      >
        <MapEffectController center={effectiveCenter} zoom={zoom} />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={18}
        />

        {useDemoLayers && layers.showRoads &&
          ROAD_SEGMENTS.map((road, index) => (
            <Polyline
              key={`road-${index}`}
              positions={road}
              pathOptions={{
                color: '#64748b',
                weight: 3,
                dashArray: '4, 6',
                opacity: 0.75,
              }}
            >
              <Tooltip sticky>Demonstration road layer</Tooltip>
            </Polyline>
          ))}

        {layers.showInundation && validGeoJson && (
          <GeoJSON
            key={JSON.stringify(inundationGeoJson)}
            data={inundationGeoJson}
            style={() => ({
              color: '#dc2626',
              weight: 2,
              fillColor: '#ef4444',
              fillOpacity: 0.45,
            })}
            onEachFeature={(feature, layer) => {
              const properties = feature?.properties || {};
              const description = properties.name || properties.description;
              if (description) layer.bindPopup(String(description));
            }}
          />
        )}

        {showDemo && layers.showInundation &&
          demoPolygons.waterExtent.map((ring, index) => (
            <Polygon
              key={`demo-water-${validHorizon}-${index}`}
              positions={ring}
              pathOptions={{
                color: '#0284c7',
                fillColor: '#38bdf8',
                fillOpacity: 0.28,
                weight: 1.5,
                dashArray: '5, 5',
              }}
            >
              <Popup>
                <strong>Demonstration water extent</strong>
                <p>This is sample map data, not a backend-generated flood projection.</p>
              </Popup>
            </Polygon>
          ))}

        {showDemo && layers.showRiskZones &&
          demoPolygons.moderateRisk.map((ring, index) => (
            <Polygon
              key={`demo-moderate-${validHorizon}-${index}`}
              positions={ring}
              pathOptions={{
                color: '#d97706',
                fillColor: '#f59e0b',
                fillOpacity: 0.28,
                weight: 1.5,
                dashArray: '5, 5',
              }}
            >
              <Popup>
                <strong>Demonstration moderate-risk zone</strong>
                <p>Illustrative geometry only; depth is not verified.</p>
              </Popup>
            </Polygon>
          ))}

        {showDemo && layers.showRiskZones &&
          demoPolygons.highRisk.map((ring, index) => (
            <Polygon
              key={`demo-high-${validHorizon}-${index}`}
              positions={ring}
              pathOptions={{
                color: '#b91c1c',
                fillColor: '#ef4444',
                fillOpacity: 0.3,
                weight: 2,
                dashArray: '5, 5',
              }}
            >
              <Popup>
                <strong>Demonstration high-risk zone</strong>
                <p>Illustrative geometry only; not a verified flood warning.</p>
              </Popup>
            </Polygon>
          ))}

        {useDemoLayers && layers.showRiver && (
          <Polyline
            positions={RIVER_CENTERLINE}
            pathOptions={{
              color: '#0369a1',
              weight: 4.5,
              opacity: 0.9,
            }}
          >
            <Tooltip sticky>Demonstration river centerline</Tooltip>
          </Polyline>
        )}

        {useDemoLayers && layers.showSettlements &&
          SETTLEMENT_MARKERS.map((location) => {
            const high = location.risk === 'HIGH';

            return (
              <CircleMarker
                key={location.id}
                center={[location.lat, location.lng]}
                radius={high ? 7 : 5.5}
                pathOptions={{
                  color: high ? '#991b1b' : '#b45309',
                  fillColor: high ? '#dc2626' : '#f59e0b',
                  fillOpacity: 0.9,
                  weight: 1.5,
                }}
              >
                <Tooltip>
                  {location.name} — demonstration data
                </Tooltip>
                <Popup>
                  <strong>{location.name}</strong>
                  <p>Sample marker; risk and depth values are not verified.</p>
                </Popup>
              </CircleMarker>
            );
          })}

        {useDemoLayers && layers.showStations &&
          HYDRO_STATIONS.map((station) => {
            const critical = station.status === 'critical';
            const warning = station.status === 'warning';
            const color = critical
              ? '#dc2626'
              : warning
                ? '#d97706'
                : '#2563eb';

            return (
              <CircleMarker
                key={station.id}
                center={[station.lat, station.lng]}
                radius={6.5}
                pathOptions={{
                  color: '#0f172a',
                  fillColor: color,
                  fillOpacity: 1,
                  weight: 2,
                }}
              >
                <Tooltip>{station.name} — sample station</Tooltip>
                <Popup>
                  <strong>{station.name}</strong>
                  <p>Sample station data; live sensor measurements have not been verified.</p>
                </Popup>
              </CircleMarker>
            );
          })}

        {selectedLocation?.latitude != null &&
          selectedLocation?.longitude != null && (
            <Marker
              position={[
                Number(selectedLocation.latitude),
                Number(selectedLocation.longitude),
              ]}
              icon={createSelectedLocationIcon(isHighRisk)}
            >
              <Tooltip direction="top" offset={[0, -28]} permanent>
                {selectedLocation.name || 'Selected Location'}
              </Tooltip>
              <Popup>
                <strong>{selectedLocation.name || 'Selected location'}</strong>
                <p>
                  Latitude: {Number(selectedLocation.latitude).toFixed(4)}
                  <br />
                  Longitude: {Number(selectedLocation.longitude).toFixed(4)}
                </p>
                {predictionResult && (
                  <p>
                    Risk: {predictionResult.risk_level || 'Pending'}
                    <br />
                    Probability:{' '}
                    {typeof predictionResult.flood_probability === 'number'
                      ? `${(predictionResult.flood_probability * 100).toFixed(1)}%`
                      : 'Unavailable'}
                  </p>
                )}
              </Popup>
            </Marker>
          )}
      </MapContainer>
    </div>
  );
};