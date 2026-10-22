
import math
import logging
from typing import Any, Dict

import rasterio
from rasterio.errors import RasterioError


logger = logging.getLogger(__name__)

WORLDCOVER_BASE_URL = (
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/"
    "v200/2021/map/"
)

# ESA WorldCover 2021 v200 official class codes.
LAND_COVER_CLASSES = {
    10: "tree_cover",
    20: "shrubland",
    30: "grassland",
    40: "cropland",
    50: "built_up",
    60: "bare_sparse_vegetation",
    70: "snow_ice",
    80: "permanent_water",
    90: "herbaceous_wetland",
    95: "mangroves",
    100: "moss_lichen",
}

# Broad categories for the existing model's land_use feature.
# These mappings are a simplification of ESA's original classes.
MODEL_LAND_USE = {
    10: "forest",
    20: "shrubland",
    30: "grassland",
    40: "agriculture",
    50: "urban",
    60: "barren",
    70: "snow_ice",
    80: "water",
    90: "wetland",
    95: "wetland",
    100: "grassland",
}


class TerrainLandCoverError(Exception):
    """Raised when land-cover data cannot be retrieved or read."""


def _validate_coordinates(latitude: float, longitude: float):
    try:
        latitude = float(latitude)
        longitude = float(longitude)
    except (TypeError, ValueError) as exc:
        raise TerrainLandCoverError(
            "Latitude and longitude must be numeric."
        ) from exc

    if not math.isfinite(latitude) or not -90 <= latitude <= 90:
        raise TerrainLandCoverError(
            "Latitude must be between -90 and 90."
        )

    if not math.isfinite(longitude) or not -180 <= longitude <= 180:
        raise TerrainLandCoverError(
            "Longitude must be between -180 and 180."
        )

    # The poles and the +180 longitude boundary need special handling.
    if latitude == 90 or longitude == 180:
        raise TerrainLandCoverError(
            "The coordinate is on a dataset boundary and cannot "
            "be assigned to a tile by this provider."
        )

    return latitude, longitude


def _tile_name(latitude: float, longitude: float) -> str:
    """Return the ESA WorldCover 3-degree tile name."""
    south_west_lat = math.floor(latitude / 3) * 3
    south_west_lon = math.floor(longitude / 3) * 3

    lat_prefix = "N" if south_west_lat >= 0 else "S"
    lon_prefix = "E" if south_west_lon >= 0 else "W"

    return (
        f"{lat_prefix}{abs(south_west_lat):02d}"
        f"{lon_prefix}{abs(south_west_lon):03d}"
    )


def fetch_landcover_features(
    latitude: float,
    longitude: float,
) -> Dict[str, Any]:
    """
    Retrieve ESA WorldCover 2021 class for one coordinate.

    Uses Rasterio's GDAL virtual filesystem to read the remote
    Cloud-Optimized GeoTIFF without intentionally downloading the
    complete tile to a local file.

    Returns:
        latitude
        longitude
        land_cover: official-style class label
        land_use: broad category for the existing model
        land_cover_class_code: original ESA numeric class
        land_cover_source: dataset attribution
        land_cover_year: reference year of the dataset

    This function does not estimate imperviousness, slope,
    drainage density, or catchment area.
    """
    latitude, longitude = _validate_coordinates(
        latitude, longitude
    )

    tile = _tile_name(latitude, longitude)

    filename = (
        f"ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"
    )

    url = WORLDCOVER_BASE_URL + filename
    vsi_url = "/vsicurl/" + url

    try:
        # COG access uses HTTP range requests where supported.
        with rasterio.Env(
            GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
            CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
        ):
            with rasterio.open(vsi_url) as dataset:
                if dataset.crs is None:
                    raise TerrainLandCoverError(
                        "Land-cover raster has no coordinate reference system."
                    )

                if dataset.count < 1:
                    raise TerrainLandCoverError(
                        "Land-cover raster contains no data bands."
                    )

                if dataset.crs.to_epsg() != 4326:
                    raise TerrainLandCoverError(
                        "Expected the WorldCover raster in EPSG:4326."
                    )

                # The raster is in geographic latitude/longitude.
                row, col = dataset.index(longitude, latitude)

                if (
                    row < 0
                    or col < 0
                    or row >= dataset.height
                    or col >= dataset.width
                ):
                    raise TerrainLandCoverError(
                        "Coordinate is outside the selected raster tile."
                    )

                values = dataset.read(
                    1,
                    window=((row, row + 1), (col, col + 1)),
                    masked=True,
                )

                if values.size == 0 or bool(values.mask[0, 0]):
                    raise TerrainLandCoverError(
                        "No land-cover observation exists at this coordinate."
                    )

                class_code = int(values[0, 0])

    except TerrainLandCoverError:
        raise
    except (RasterioError, OSError, RuntimeError, ValueError) as exc:
        logger.warning(
            "WorldCover retrieval failed for tile %s: %s",
            tile,
            exc,
        )
        raise TerrainLandCoverError(
            "Could not retrieve the ESA WorldCover tile. "
            "Check internet access, the tile URL, and the provider."
        ) from exc

    if class_code not in LAND_COVER_CLASSES:
        raise TerrainLandCoverError(
            f"Unexpected or unsupported WorldCover class: {class_code}"
        )

    return {
        "latitude": latitude,
        "longitude": longitude,
        "land_cover": LAND_COVER_CLASSES[class_code],
        "land_use": MODEL_LAND_USE[class_code],
        "land_cover_class_code": class_code,
        "land_cover_source": "ESA WorldCover 2021 v200",
        "land_cover_year": 2021,
    }
