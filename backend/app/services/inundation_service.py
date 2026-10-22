
import json
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.inundation import InundationResult
from app.models.prediction import Prediction
from app.models.prediction_request import PredictionRequest
from app.models.location import Location
from app.schemas.inundation import InundationResponse, InundationCreate

logger = logging.getLogger("flood_backend.inundation_service")


class InundationService:
    """Retrieve and store inundation results linked to valid predictions."""

    @staticmethod
    def get_inundation(
        db: Session,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        date: Optional[str] = None,
        request_id: Optional[int] = None,
        prediction_id: Optional[int] = None,
    ) -> InundationResponse:
        inundation = None
        matched_prediction = None

        try:
            if prediction_id is not None:
                matched_prediction = (
                    db.query(Prediction)
                    .filter(Prediction.id == prediction_id)
                    .first()
                )

                if matched_prediction:
                    inundation = (
                        db.query(InundationResult)
                        .filter(
                            InundationResult.prediction_id
                            == matched_prediction.id
                        )
                        .first()
                    )

            elif request_id is not None:
                matched_prediction = (
                    db.query(Prediction)
                    .filter(
                        Prediction.prediction_request_id == request_id
                    )
                    .first()
                )

                if matched_prediction:
                    inundation = (
                        db.query(InundationResult)
                        .filter(
                            InundationResult.prediction_id
                            == matched_prediction.id
                        )
                        .first()
                    )

            elif (
                date is not None
                and latitude is not None
                and longitude is not None
            ):
                parsed_date = datetime.strptime(
                    date.strip(), "%Y-%m-%d"
                ).date()

                tolerance = 0.01

                inundation = (
                    db.query(InundationResult)
                    .join(
                        Prediction,
                        InundationResult.prediction_id == Prediction.id,
                    )
                    .join(
                        PredictionRequest,
                        Prediction.prediction_request_id
                        == PredictionRequest.id,
                    )
                    .join(
                        Location,
                        PredictionRequest.location_id == Location.id,
                    )
                    .filter(
                        PredictionRequest.prediction_date == parsed_date,
                        Location.latitude.between(
                            latitude - tolerance,
                            latitude + tolerance,
                        ),
                        Location.longitude.between(
                            longitude - tolerance,
                            longitude + tolerance,
                        ),
                    )
                    .first()
                )

                if inundation:
                    matched_prediction = (
                        db.query(Prediction)
                        .filter(
                            Prediction.id == inundation.prediction_id
                        )
                        .first()
                    )

        except ValueError as exc:
            raise ValueError(
                "Invalid date. Expected YYYY-MM-DD."
            ) from exc

        if inundation is None or not inundation.geojson:
            return InundationResponse(
                available=False,
                geojson=None,
                maximum_depth=None,
                flooded_area_km2=None,
                prediction_id=(
                    matched_prediction.id
                    if matched_prediction
                    else prediction_id
                ),
                prediction_request_id=(
                    matched_prediction.prediction_request_id
                    if matched_prediction
                    else request_id
                ),
                message="No inundation record exists for the requested parameters.",
            )

        try:
            if isinstance(inundation.geojson, str):
                parsed_geojson = json.loads(inundation.geojson)
            else:
                parsed_geojson = inundation.geojson
        except (ValueError, TypeError) as exc:
            logger.exception(
                "Invalid GeoJSON stored for inundation ID %s",
                inundation.id,
            )
            raise ValueError(
                "The stored inundation GeoJSON is invalid."
            ) from exc

        return InundationResponse(
            available=True,
            geojson=parsed_geojson,
            maximum_depth=inundation.maximum_depth,
            flooded_area_km2=inundation.flooded_area_km2,
            prediction_id=inundation.prediction_id,
            prediction_request_id=(
                matched_prediction.prediction_request_id
                if matched_prediction
                else request_id
            ),
            message="Inundation spatial result retrieved from database.",
        )

    @staticmethod
    def save_inundation(
        db: Session,
        data: InundationCreate,
    ) -> InundationResult:
        """Save an inundation result only for an existing prediction."""

        pred_id = data.prediction_id
        prediction = None

        try:
            # Resolve and validate the associated prediction.
            if pred_id is not None:
                prediction = (
                    db.query(Prediction)
                    .filter(Prediction.id == pred_id)
                    .first()
                )

                if prediction is None:
                    raise ValueError(
                        f"Prediction ID {pred_id} does not exist."
                    )

            if data.prediction_request_id is not None:
                request_record = (
                    db.query(PredictionRequest)
                    .filter(
                        PredictionRequest.id
                        == data.prediction_request_id
                    )
                    .first()
                )

                if request_record is None:
                    raise ValueError(
                        "The supplied prediction_request_id does not exist."
                    )

                request_prediction = (
                    db.query(Prediction)
                    .filter(
                        Prediction.prediction_request_id
                        == request_record.id
                    )
                    .first()
                )

                if prediction is not None:
                    if (
                        prediction.prediction_request_id
                        != request_record.id
                    ):
                        raise ValueError(
                            "prediction_id and prediction_request_id "
                            "refer to different requests."
                        )
                else:
                    prediction = request_prediction

                if prediction is None:
                    raise ValueError(
                        "No prediction record exists for this request. "
                        "Run POST /api/predict first."
                    )

                pred_id = prediction.id

            if pred_id is None or prediction is None:
                raise ValueError(
                    "A valid prediction_id or prediction_request_id "
                    "is required."
                )

            # Ensure the submitted GeoJSON is valid JSON.
            geojson_value = data.geojson

            if isinstance(geojson_value, str):
                try:
                    parsed = json.loads(geojson_value)
                except (ValueError, TypeError) as exc:
                    raise ValueError(
                        "geojson must contain valid JSON."
                    ) from exc
            else:
                parsed = geojson_value

            if not isinstance(parsed, dict):
                raise ValueError(
                    "geojson must be a GeoJSON object."
                )

            if parsed.get("type") not in {
                "Feature",
                "FeatureCollection",
                "Point",
                "MultiPoint",
                "LineString",
                "MultiLineString",
                "Polygon",
                "MultiPolygon",
                "GeometryCollection",
            }:
                raise ValueError(
                    "geojson must have a valid GeoJSON type."
                )

            # Keep the database representation compatible with a text column.
            geojson_text = json.dumps(parsed)

            record = InundationResult(
                prediction_id=pred_id,
                geojson=geojson_text,
                maximum_depth=data.maximum_depth,
                flooded_area_km2=data.flooded_area_km2,
            )

            db.add(record)
            db.commit()
            db.refresh(record)
            return record

        except ValueError:
            db.rollback()
            raise
        except Exception:
            db.rollback()
            logger.exception("Failed to save inundation result")
            raise


inundation_service = InundationService()
