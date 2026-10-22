
import logging
import math
from datetime import date
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import HTTPException, status
from sqlalchemy import desc
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.location import Location
from app.models.environmental_data import EnvironmentalData
from app.models.prediction_request import PredictionRequest
from app.models.prediction import Prediction

from app.schemas.prediction import (
    PredictionRequestCreate,
    PredictionResponse,
    PredictionHistoryItem,
    PredictionInundationSummary,
    LocationNested,
)

from app.services.model_service import model_service
from app.services.weather_provider import (
    fetch_weather_features,
    WeatherProviderError,
)

logger = logging.getLogger(__name__)


# These names and their order must match the model's training pipeline.
REQUIRED_MODEL_FEATURES = [
    "latitude",
    "longitude",
    "catchment_area_km2",
    "elevation_m",
    "rainfall_1h_mm",
    "rainfall_3h_mm",
    "rainfall_6h_mm",
    "rainfall_24h_mm",
    "antecedent_rainfall_3d_mm",
    "soil_moisture_pct",
    "upstream_level_change_3h_m",
    "river_water_level_m",
    "river_discharge_m3s",
    "reservoir_release_m3s",
    "slope_deg",
    "drainage_density_km_per_km2",
    "land_use",
    "impervious_surface_pct",
    "tide_level_m",
]

NUMERIC_FEATURES = [
    feature
    for feature in REQUIRED_MODEL_FEATURES
    if feature != "land_use"
]

ENVIRONMENTAL_COLUMNS = {
    feature: feature for feature in REQUIRED_MODEL_FEATURES
}


class PredictionService:
    """Fetch environmental features, predict risk, and persist results."""

    @staticmethod
    def classify_risk(probability: Optional[float]) -> str:
        if probability is None:
            return "PENDING"
        if probability >= 0.75:
            return "HIGH"
        if probability >= 0.40:
            return "MODERATE"
        return "LOW"

    @staticmethod
    def _finite_float(value: Any) -> Optional[float]:
        if value is None or isinstance(value, bool):
            return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return number if math.isfinite(number) else None

    @staticmethod
    def _location_name(location: Location) -> str:
        return (
            getattr(location, "name", None)
            or f"Coordinates ({location.latitude:.5f}, "
            f"{location.longitude:.5f})"
        )

    @classmethod
    def get_or_create_location(
        cls,
        db: Session,
        latitude: float,
        longitude: float,
        name: Optional[str] = None,
    ) -> Location:
        location = (
            db.query(Location)
            .filter(
                Location.latitude == latitude,
                Location.longitude == longitude,
            )
            .first()
        )

        if location is not None:
            if (
                name
                and hasattr(location, "name")
                and not getattr(location, "name", None)
            ):
                location.name = name
            return location

        values: Dict[str, Any] = {
            "latitude": latitude,
            "longitude": longitude,
        }

        if hasattr(Location, "name"):
            values["name"] = name or (
                f"Coordinates ({latitude:.5f}, {longitude:.5f})"
            )

        location = Location(**values)
        db.add(location)
        db.flush()
        return location

    @staticmethod
    def _build_response(
        request_record: PredictionRequest,
        prediction: Optional[Prediction] = None,
        message: Optional[str] = None,
        missing_features: Optional[List[str]] = None,
        available_features: Optional[List[str]] = None,
    ) -> PredictionResponse:
        location = request_record.location

        probability = (
            prediction.flood_probability
            if prediction is not None
            else None
        )

        risk = (
            prediction.risk_level
            if prediction is not None and prediction.risk_level
            else "PENDING"
        )

        return PredictionResponse(
            status=request_record.status,
            prediction_request_id=request_record.id,
            location=LocationNested(
                name=PredictionService._location_name(location),
                latitude=location.latitude,
                longitude=location.longitude,
            ),
            date=request_record.prediction_date.isoformat(),
            request_id=request_record.id,
            latitude=location.latitude,
            longitude=location.longitude,
            location_name=PredictionService._location_name(location),
            flood_probability=probability,
            risk_level=risk,
            flood_occurred=(
                prediction.flood_occurred
                if prediction is not None
                else None
            ),
            inundation=PredictionInundationSummary(
                available=False,
                geojson=None,
            ),
            message=message,
            missing_features=missing_features or [],
            available_features=available_features or [],
            created_at=request_record.created_at,
        )

    @staticmethod
    def _read_existing_environment(
        db: Session,
        location_id: int,
        target_date: date,
    ) -> Optional[EnvironmentalData]:
        return (
            db.query(EnvironmentalData)
            .filter(
                EnvironmentalData.location_id == location_id,
                EnvironmentalData.date == target_date,
            )
            .first()
        )

    @staticmethod
    def _save_environment_snapshot(
        db: Session,
        location_id: int,
        target_date: date,
        features: Dict[str, Any],
        existing: Optional[EnvironmentalData],
    ) -> EnvironmentalData:
        snapshot = existing

        if snapshot is None:
            snapshot = EnvironmentalData(
                location_id=location_id,
                date=target_date,
                latitude=features["latitude"],
                longitude=features["longitude"],
            )
            db.add(snapshot)

        for feature, column in ENVIRONMENTAL_COLUMNS.items():
            value = features.get(feature)

            if value is not None and hasattr(snapshot, column):
                setattr(snapshot, column, value)

        # Preserve legacy database column compatibility.
        if features.get("rainfall_24h_mm") is not None:
            if hasattr(snapshot, "rainfall_mm"):
                snapshot.rainfall_mm = features["rainfall_24h_mm"]

        if features.get("river_water_level_m") is not None:
            if hasattr(snapshot, "water_level_m"):
                snapshot.water_level_m = features["river_water_level_m"]

        if features.get("land_use") is not None:
            if hasattr(snapshot, "land_cover"):
                snapshot.land_cover = features["land_use"]

        db.flush()
        return snapshot

    def process_prediction_request(
        self,
        db: Session,
        request_data: PredictionRequestCreate,
    ) -> PredictionResponse:
        try:
            latitude = float(request_data.latitude)
            longitude = float(request_data.longitude)
            target_date = date.fromisoformat(request_data.date)

            if not math.isfinite(latitude) or not -90 <= latitude <= 90:
                raise HTTPException(
                    status_code=422,
                    detail="Latitude must be between -90 and 90.",
                )

            if not math.isfinite(longitude) or not -180 <= longitude <= 180:
                raise HTTPException(
                    status_code=422,
                    detail="Longitude must be between -180 and 180.",
                )

            location = self.get_or_create_location(
                db=db,
                latitude=latitude,
                longitude=longitude,
                name=request_data.location_name or request_data.name,
            )

            request_record = PredictionRequest(
                location_id=location.id,
                prediction_date=target_date,
                status="FETCHING_ENVIRONMENTAL_DATA",
            )
            db.add(request_record)
            db.flush()

            environmental = self._read_existing_environment(
                db=db,
                location_id=location.id,
                target_date=target_date,
            )

            features: Dict[str, Any] = {}

            # Start with values already stored for this location and date.
            if environmental is not None:
                for feature, column in ENVIRONMENTAL_COLUMNS.items():
                    if hasattr(environmental, column):
                        value = getattr(environmental, column, None)
                        if value is not None:
                            features[feature] = value

            # Weather measurements can supply only the fields returned
            # by the provider. Do not invent missing measurements.
            try:
                weather_features = fetch_weather_features(
                    latitude=latitude,
                    longitude=longitude,
                    target_date=target_date,
                ) or {}

                if not isinstance(weather_features, dict):
                    logger.warning(
                        "Weather provider returned an unexpected response type."
                    )
                    weather_features = {}

                features.update({
                    key: value
                    for key, value in weather_features.items()
                    if key in REQUIRED_MODEL_FEATURES and value is not None
                })

            except WeatherProviderError as exc:
                logger.warning(
                    "Weather provider unavailable: %s", exc
                )
            except Exception:
                logger.exception(
                    "Unexpected weather provider failure."
                )

            # Read and validate caller-supplied features.
            supplied = request_data.model_features or {}

            if not isinstance(supplied, dict):
                raise HTTPException(
                    status_code=422,
                    detail="model_features must be a JSON object.",
                )

            unknown = set(supplied) - set(REQUIRED_MODEL_FEATURES)

            if unknown:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "message": "Unknown model feature names.",
                        "unknown_features": sorted(unknown),
                    },
                )

            logger.info(
                "Prediction request %s received feature names: %s",
                request_record.id,
                sorted(supplied.keys()),
            )

            # Explicit user-supplied values override stored/weather values.
            # Empty strings and nulls are not treated as measurements.
            for key, value in supplied.items():
                if value is None:
                    continue
                if isinstance(value, str) and not value.strip():
                    continue
                features[key] = value

            # Coordinates must always correspond to the request.
            features["latitude"] = latitude
            features["longitude"] = longitude

            invalid_features: List[str] = []

            for feature in NUMERIC_FEATURES:
                value = features.get(feature)

                if value is None:
                    continue

                number = self._finite_float(value)

                if number is None:
                    invalid_features.append(feature)
                else:
                    features[feature] = number

            if invalid_features:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "message": "Some model features are not valid numbers.",
                        "invalid_features": invalid_features,
                    },
                )

            if features.get("land_use") is not None:
                features["land_use"] = str(
                    features["land_use"]
                ).strip()

                if not features["land_use"]:
                    features.pop("land_use", None)

            missing = [
                feature
                for feature in REQUIRED_MODEL_FEATURES
                if features.get(feature) is None
                or (
                    isinstance(features.get(feature), str)
                    and not features[feature].strip()
                )
            ]

            available = [
                feature
                for feature in REQUIRED_MODEL_FEATURES
                if feature not in missing
            ]

            logger.info(
                "Prediction request %s merged features: %s",
                request_record.id,
                sorted(features.keys()),
            )
            logger.info(
                "Prediction request %s missing features: %s",
                request_record.id,
                missing,
            )

            # Persist available measurements even if inference must wait.
            self._save_environment_snapshot(
                db=db,
                location_id=location.id,
                target_date=target_date,
                features=features,
                existing=environmental,
            )

            if missing:
                request_record.status = "NEEDS_ENVIRONMENTAL_DATA"
                db.commit()
                db.refresh(request_record)

                return self._build_response(
                    request_record,
                    message=(
                        "Required environmental features are still missing. "
                        "Supply the listed values and submit the prediction again."
                    ),
                    missing_features=missing,
                    available_features=available,
                )

            # Validate percentages before model inference.
            for feature in (
                "soil_moisture_pct",
                "impervious_surface_pct",
            ):
                if not 0 <= features[feature] <= 100:
                    raise HTTPException(
                        status_code=422,
                        detail=f"{feature} must be between 0 and 100.",
                    )

            # Preserve the model's required feature order.
            input_frame = pd.DataFrame(
                [
                    {
                        feature: features[feature]
                        for feature in REQUIRED_MODEL_FEATURES
                    }
                ],
                columns=REQUIRED_MODEL_FEATURES,
            )

            request_record.status = "PROCESSING"
            db.flush()

            result = model_service.predict(input_frame)

            if not isinstance(result, dict):
                raise ValueError(
                    "model_service.predict must return a dictionary."
                )

            probability = self._finite_float(
                result.get("flood_probability")
            )

            if probability is None or not 0 <= probability <= 1:
                raise ValueError(
                    "The model did not return a valid flood probability."
                )

            predicted_class = result.get("predicted_flood")

            if predicted_class is None:
                predicted_class = int(probability >= 0.5)
            else:
                try:
                    predicted_class = int(predicted_class)
                except (TypeError, ValueError) as exc:
                    raise ValueError(
                        "The model returned an invalid predicted_flood value."
                    ) from exc

            if predicted_class not in (0, 1):
                raise ValueError(
                    "predicted_flood must be either 0 or 1."
                )

            risk = self.classify_risk(probability)

            prediction = (
                db.query(Prediction)
                .filter(
                    Prediction.prediction_request_id == request_record.id
                )
                .first()
            )

            if prediction is None:
                prediction = Prediction(
                    prediction_request_id=request_record.id,
                    flood_probability=probability,
                    risk_level=risk,
                    flood_occurred=predicted_class,
                )
                db.add(prediction)
            else:
                prediction.flood_probability = probability
                prediction.risk_level = risk
                prediction.flood_occurred = predicted_class

            request_record.status = "COMPLETED"
            db.commit()
            db.refresh(request_record)
            db.refresh(prediction)

            return self._build_response(
                request_record,
                prediction=prediction,
                message=(
                    "Model inference completed. This model was trained "
                    "on synthetic data and has not been validated for "
                    "real-world flood warnings. Inundation geometry has "
                    "not been generated."
                ),
            )

        except HTTPException:
            db.rollback()
            raise

        except (SQLAlchemyError, ValueError, TypeError, KeyError):
            db.rollback()
            logger.exception("Prediction processing failed.")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    "Prediction processing failed. Check the backend "
                    "terminal logs for details."
                ),
            )

        except Exception:
            db.rollback()
            logger.exception("Unexpected prediction failure.")
            raise HTTPException(
                status_code=500,
                detail=(
                    "Unexpected prediction failure. Check backend logs."
                ),
            )

    def get_history(
        self,
        db: Session,
        limit: int = 50,
    ) -> List[PredictionHistoryItem]:
        rows = (
            db.query(PredictionRequest)
            .order_by(desc(PredictionRequest.created_at))
            .limit(limit)
            .all()
        )

        history: List[PredictionHistoryItem] = []

        for request in rows:
            location = request.location
            prediction = request.prediction

            history.append(
                PredictionHistoryItem(
                    id=request.id,
                    location_id=request.location_id,
                    location_name=self._location_name(location),
                    latitude=location.latitude,
                    longitude=location.longitude,
                    prediction_date=request.prediction_date,
                    status=request.status,
                    created_at=request.created_at,
                    flood_probability=(
                        prediction.flood_probability
                        if prediction is not None
                        else None
                    ),
                    risk_level=(
                        prediction.risk_level
                        if prediction is not None
                        else None
                    ),
                    flood_occurred=(
                        prediction.flood_occurred
                        if prediction is not None
                        else None
                    ),
                )
            )

        return history

    def get_by_id(
        self,
        db: Session,
        request_id: int,
    ) -> Optional[PredictionResponse]:
        request = (
            db.query(PredictionRequest)
            .filter(PredictionRequest.id == request_id)
            .first()
        )

        if request is None:
            return None

        prediction = (
            db.query(Prediction)
            .filter(
                Prediction.prediction_request_id == request.id
            )
            .first()
        )

        return self._build_response(
            request,
            prediction=prediction,
            message="Stored prediction request retrieved.",
        )


prediction_service = PredictionService()
