
from pathlib import Path
import sys

import pandas as pd

# Import the existing model service from the backend.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services.model_service import model_service
from app.services.prediction_service import REQUIRED_MODEL_FEATURES

if not model_service.get_load_status()["is_loaded"]:
    raise RuntimeError(model_service.get_load_status())

# Controlled test scenarios only, not real-world warnings.
scenarios = [
    {
        "name": "Moderate rainfall",
        "rainfall_1h_mm": 20,
        "rainfall_3h_mm": 50,
        "rainfall_6h_mm": 80,
        "rainfall_24h_mm": 120,
        "antecedent_rainfall_3d_mm": 150,
        "soil_moisture_pct": 70,
        "upstream_level_change_3h_m": 0.5,
        "river_water_level_m": 3,
        "river_discharge_m3s": 300,
        "reservoir_release_m3s": 100,
    },
    {
        "name": "Heavy rainfall",
        "rainfall_1h_mm": 60,
        "rainfall_3h_mm": 140,
        "rainfall_6h_mm": 200,
        "rainfall_24h_mm": 280,
        "antecedent_rainfall_3d_mm": 300,
        "soil_moisture_pct": 90,
        "upstream_level_change_3h_m": 1.5,
        "river_water_level_m": 6,
        "river_discharge_m3s": 1500,
        "reservoir_release_m3s": 500,
    },
    {
        "name": "Extreme synthetic stress test",
        "rainfall_1h_mm": 100,
        "rainfall_3h_mm": 250,
        "rainfall_6h_mm": 350,
        "rainfall_24h_mm": 450,
        "antecedent_rainfall_3d_mm": 500,
        "soil_moisture_pct": 98,
        "upstream_level_change_3h_m": 3,
        "river_water_level_m": 10,
        "river_discharge_m3s": 5000,
        "reservoir_release_m3s": 2000,
    },
]

base = {
    "latitude": 25.5941,
    "longitude": 85.1376,
    "catchment_area_km2": 5000,
    "elevation_m": 50,
    "slope_deg": 1.0,
    "drainage_density_km_per_km2": 3.0,
    "land_use": "urban",
    "impervious_surface_pct": 90,
    "tide_level_m": 0,
}

for scenario in scenarios:
    row = {**base, **{
        k: v for k, v in scenario.items() if k != "name"
    }}
    frame = pd.DataFrame(
        [{feature: row[feature] for feature in REQUIRED_MODEL_FEATURES}],
        columns=REQUIRED_MODEL_FEATURES,
    )

    result = model_service.predict(frame)
    probability = result["flood_probability"]

    if probability >= 0.75:
        risk = "HIGH"
    elif probability >= 0.40:
        risk = "MODERATE"
    else:
        risk = "LOW"

    print(
        f'{scenario["name"]}: '
        f'probability={probability:.8f} '
        f'({probability * 100:.4f}%), risk={risk}'
    )
