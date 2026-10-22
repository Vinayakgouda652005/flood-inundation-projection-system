
import pandas as pd
from app.services.model_service import model_service

# Check that the model loaded
status = model_service.get_load_status()
assert status["is_loaded"], status["error"]

# Sample inputs for testing only.
# These are illustrative values, not live measurements.
sample = pd.DataFrame([{
    "latitude": 25.0108,
    "longitude": 88.1411,
    "catchment_area_km2": 30000,
    "elevation_m": 28,
    "rainfall_1h_mm": 12.0,
    "rainfall_3h_mm": 25.0,
    "rainfall_6h_mm": 40.0,
    "rainfall_24h_mm": 95.0,
    "antecedent_rainfall_3d_mm": 160.0,
    "soil_moisture_pct": 65.0,
    "upstream_level_change_3h_m": 0.8,
    "river_water_level_m": 9.2,
    "river_discharge_m3s": 14000.0,
    "reservoir_release_m3s": 500.0,
    "slope_deg": 2.5,
    "drainage_density_km_per_km2": 0.8,
    "land_use": "Agriculture",
    "impervious_surface_pct": 18.0,
    "tide_level_m": 0.0,
}])

result = model_service.predict(sample)

print("Prediction test passed!")
print("Result:", result)
