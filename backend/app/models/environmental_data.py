
from sqlalchemy import (
    Column,
    Integer,
    Float,
    String,
    Date,
    DateTime,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class EnvironmentalData(Base):
    """Store environmental observations and model input features."""

    __tablename__ = "environmental_data"

    __table_args__ = (
        UniqueConstraint(
            "location_id",
            "date",
            name="uq_environmental_location_date",
        ),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)

    location_id = Column(
        Integer,
        ForeignKey("locations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    date = Column(Date, nullable=False, index=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)

    # Catchment and rainfall features
    catchment_area_km2 = Column(Float, nullable=True)
    rainfall_mm = Column(Float, nullable=True)
    rainfall_1h_mm = Column(Float, nullable=True)
    rainfall_3h_mm = Column(Float, nullable=True)
    rainfall_6h_mm = Column(Float, nullable=True)
    rainfall_24h_mm = Column(Float, nullable=True)
    antecedent_rainfall_3d_mm = Column(Float, nullable=True)

    # Meteorological features
    temperature_c = Column(Float, nullable=True)
    humidity_pct = Column(Float, nullable=True)
    soil_moisture_pct = Column(Float, nullable=True)

    # River and reservoir features
    river_water_level_m = Column(Float, nullable=True)
    water_level_m = Column(Float, nullable=True)
    upstream_level_change_3h_m = Column(Float, nullable=True)
    river_discharge_m3s = Column(Float, nullable=True)
    reservoir_release_m3s = Column(Float, nullable=True)

    # Terrain and drainage features
    elevation_m = Column(Float, nullable=True)
    slope_deg = Column(Float, nullable=True)
    drainage_density_km_per_km2 = Column(Float, nullable=True)

    # Land use and built environment
    land_use = Column(String(100), nullable=True)
    land_cover = Column(String(100), nullable=True)
    impervious_surface_pct = Column(Float, nullable=True)

    # Additional contextual data
    soil_type = Column(String(100), nullable=True)
    population_density = Column(Float, nullable=True)
    infrastructure = Column(String(255), nullable=True)
    historical_floods = Column(Integer, nullable=True)
    tide_level_m = Column(Float, nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    location = relationship(
        "Location",
        back_populates="environmental_records",
    )

    def __repr__(self) -> str:
        return (
            f"<EnvironmentalData id={self.id} "
            f"location_id={self.location_id} "
            f"date={self.date} "
            f"rainfall_24h_mm={self.rainfall_24h_mm}>"
        )
