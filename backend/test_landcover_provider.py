
from app.services.terrain_landcover_provider import (
    fetch_landcover_features,
    TerrainLandCoverError,
)

try:
    result = fetch_landcover_features(
        latitude=12.9716,
        longitude=77.5946,
    )

    print("ESA WorldCover result:")
    for key, value in result.items():
        print(f"{key}: {value}")

except TerrainLandCoverError as exc:
    print("Land-cover lookup failed:", exc)
