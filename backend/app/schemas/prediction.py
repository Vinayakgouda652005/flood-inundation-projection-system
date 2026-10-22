
from datetime import date, datetime
from typing import Optional, Any, Dict, List

from pydantic import (
    BaseModel,
    Field,
    ConfigDict,
    field_validator,
)


# ---------------------------------------------------------
# INUNDATION SUMMARY
# ---------------------------------------------------------

class PredictionInundationSummary(BaseModel):
    """
    Summary of a geographic flood-inundation result.

    GeoJSON and area/depth values remain unavailable until
    an inundation-mapping module produces them.
    """

    available: bool = False
    geojson: Optional[Any] = None
    flooded_area_km2: Optional[float] = None
    max_depth_m: Optional[float] = None
    avg_depth_m: Optional[float] = None


# ---------------------------------------------------------
# NESTED LOCATION RESPONSE
# ---------------------------------------------------------

class LocationNested(BaseModel):
    name: str
    latitude: float
    longitude: float

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------
# PREDICTION REQUEST
# ---------------------------------------------------------

class PredictionRequestCreate(BaseModel):
    """
    User-driven flood prediction request.

    Weather data is fetched separately. The optional
    model_features dictionary supplies verified environmental
    or geospatial values that the weather API cannot provide.

    Feature names must match the trained model exactly.
    """

    latitude: float = Field(
        ...,
        ge=-90.0,
        le=90.0,
        description="Latitude of the requested location",
    )

    longitude: float = Field(
        ...,
        ge=-180.0,
        le=180.0,
        description="Longitude of the requested location",
    )

    date: str = Field(
        ...,
        description="Target date in YYYY-MM-DD format",
    )

    location_name: Optional[str] = Field(
        default=None,
        max_length=255,
        description="Optional human-readable location name",
    )

    name: Optional[str] = Field(
        default=None,
        max_length=255,
        description="Alternative location name",
    )

    model_features: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Supplemental verified environmental and geospatial "
            "features for the trained flood prediction model."
        ),
    )

    @field_validator("date")
    @classmethod
    def validate_date_format(cls, value: str) -> str:
        """
        Enforce strict YYYY-MM-DD date formatting.
        """
        if not value or not isinstance(value, str):
            raise ValueError(
                "Prediction date must be a non-empty string "
                "in YYYY-MM-DD format."
            )

        cleaned_value = value.strip()

        try:
            parsed_date = datetime.strptime(
                cleaned_value,
                "%Y-%m-%d",
            )
        except ValueError as exc:
            raise ValueError(
                "Prediction date must strictly follow YYYY-MM-DD format."
            ) from exc

        if parsed_date.strftime("%Y-%m-%d") != cleaned_value:
            raise ValueError(
                "Prediction date must strictly follow YYYY-MM-DD format."
            )

        return cleaned_value


# ---------------------------------------------------------
# PREDICTION RESULT RECORD
# ---------------------------------------------------------

class PredictionRecordCreate(BaseModel):
    """
    Schema for recording a prediction result or ground truth.
    """

    prediction_request_id: int = Field(..., gt=0)

    flood_probability: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
    )

    risk_level: Optional[str] = Field(
        default=None,
        max_length=50,
    )

    flood_occurred: Optional[int] = Field(
        default=None,
        ge=0,
        le=1,
    )


# ---------------------------------------------------------
# PREDICTION RESPONSE
# ---------------------------------------------------------

class PredictionResponse(BaseModel):
    """
    Standardized response for the frontend.

    A probability is populated only after successful model
    inference and result persistence. Inundation geometry
    remains unavailable until separately generated.
    """

    status: str = "WAITING_FOR_AI_MODEL"

    prediction_request_id: int

    location: LocationNested

    date: str

    # Compatibility fields for existing frontend consumers.
    request_id: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_name: Optional[str] = None

    # Model result fields.
    flood_probability: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
    )

    risk_level: Optional[str] = "PENDING"

    flood_occurred: Optional[int] = Field(
        default=None,
        ge=0,
        le=1,
    )

    # Geographic inundation output.
    inundation: PredictionInundationSummary = Field(
        default_factory=PredictionInundationSummary,
    )

    message: Optional[str] = None
        # Dynamic environmental-data form support
    missing_features: List[str] = Field(default_factory=list)
    available_features: List[str] = Field(default_factory=list)

    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------
# PREDICTION HISTORY
# ---------------------------------------------------------

class PredictionHistoryItem(BaseModel):
    """
    One prediction request and its stored result for history.
    """

    id: int
    location_id: int

    location_name: Optional[str] = None

    latitude: float
    longitude: float

    prediction_date: date

    status: str

    created_at: datetime

    flood_probability: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
    )

    risk_level: Optional[str] = None

    flood_occurred: Optional[int] = Field(
        default=None,
        ge=0,
        le=1,
    )

    model_config = ConfigDict(from_attributes=True)
