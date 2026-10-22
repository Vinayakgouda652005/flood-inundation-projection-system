
from datetime import date, datetime, timedelta
from math import isfinite
from zoneinfo import ZoneInfo

import requests


FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
TIMEZONE = "Asia/Kolkata"
REQUEST_TIMEOUT_SECONDS = 20
MAX_FORECAST_DAYS = 15


class WeatherProviderError(Exception):
    """Raised when weather data cannot be retrieved or validated."""


def _valid_number(value):
    """Return a finite float, or None for invalid/missing values."""
    if value is None or isinstance(value, bool):
        return None

    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    return number if isfinite(number) else None


def _get_hourly_value(values, index):
    """Read a validated numeric value at an hourly index."""
    if not isinstance(values, list) or index >= len(values):
        return None

    return _valid_number(values[index])


def fetch_weather_features(
    latitude: float,
    longitude: float,
    target_date: date,
) -> dict:
    """
    Fetch hourly weather inputs for a location and target date.

    Rainfall windows:
      rainfall_1h_mm  = precipitation at the final target-day hour
      rainfall_3h_mm  = sum of the final 3 hourly observations
      rainfall_6h_mm  = sum of the final 6 hourly observations
      rainfall_24h_mm = sum of the final 24 hourly observations

    Antecedent rainfall is the 72 hours before the target date.
    Soil moisture is the average of valid hourly values on the target date.

    Missing observations remain None; they are never converted to zero.
    """
    if not isinstance(target_date, date) or isinstance(target_date, datetime):
        raise WeatherProviderError(
            "target_date must be a datetime.date value."
        )

    latitude = _valid_number(latitude)
    longitude = _valid_number(longitude)

    if latitude is None or not -90 <= latitude <= 90:
        raise WeatherProviderError("Latitude must be between -90 and 90.")

    if longitude is None or not -180 <= longitude <= 180:
        raise WeatherProviderError("Longitude must be between -180 and 180.")

    today = datetime.now(ZoneInfo(TIMEZONE)).date()

    if target_date > today + timedelta(days=MAX_FORECAST_DAYS):
        raise WeatherProviderError(
            "The requested date is outside the configured forecast horizon."
        )

    is_historical = target_date < today

    if is_historical:
        url = ARCHIVE_URL
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "start_date": (
                target_date - timedelta(days=3)
            ).isoformat(),
            "end_date": target_date.isoformat(),
            "hourly": (
                "precipitation,soil_moisture_0_to_7cm"
            ),
            "timezone": TIMEZONE,
        }
    else:
        url = FORECAST_URL
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "past_days": 3,
            "forecast_days": 16,
            "hourly": (
                "precipitation,soil_moisture_0_to_7cm"
            ),
            "timezone": TIMEZONE,
        }

    try:
        response = requests.get(
            url,
            params=params,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise WeatherProviderError(
            f"Weather provider request failed: {exc}"
        ) from exc

    if not isinstance(payload, dict):
        raise WeatherProviderError(
            "Weather provider returned an invalid response."
        )

    if payload.get("error"):
        raise WeatherProviderError(
            str(payload.get("reason", "Weather provider returned an error."))
        )

    hourly = payload.get("hourly")
    if not isinstance(hourly, dict):
        raise WeatherProviderError(
            "Weather provider did not return hourly data."
        )

    times = hourly.get("time")
    precipitation = hourly.get("precipitation")
    soil_moisture = hourly.get("soil_moisture_0_to_7cm")

    if not isinstance(times, list) or not times:
        raise WeatherProviderError(
            "Weather provider returned no hourly timestamps."
        )

    if not isinstance(precipitation, list) or len(precipitation) != len(times):
        raise WeatherProviderError(
            "Hourly precipitation data is incomplete or malformed."
        )

    target_day = target_date.isoformat()

    try:
        parsed_times = [
            datetime.fromisoformat(timestamp)
            for timestamp in times
        ]
    except (TypeError, ValueError) as exc:
        raise WeatherProviderError(
            "Weather provider returned an invalid timestamp."
        ) from exc

    # Use only timestamps on or before the target date.
    eligible_indices = [
        i for i, timestamp in enumerate(parsed_times)
        if timestamp.date() <= target_date
    ]

    target_indices = [
        i for i, timestamp in enumerate(parsed_times)
        if timestamp.date() == target_date
    ]

    if not target_indices:
        raise WeatherProviderError(
            f"No hourly weather data was returned for {target_day}."
        )

    # Validate hourly cadence: missing timestamps must not be mistaken
    # for zero-rainfall hours.
    timestamp_to_index = {
        parsed_times[i]: i for i in eligible_indices
    }

    last_timestamp = parsed_times[target_indices[-1]]

    def trailing_rainfall(hours):
        indices = []

        for offset in range(hours - 1, -1, -1):
            expected_timestamp = last_timestamp - timedelta(hours=offset)
            index = timestamp_to_index.get(expected_timestamp)

            if index is None:
                return None

            indices.append(index)

        values = [
            _get_hourly_value(precipitation, index)
            for index in indices
        ]

        if any(value is None for value in values):
            return None

        return sum(values)

    # Require exactly the preceding 72 hourly timestamps, excluding
    # the target date. This feature is not the target day's rainfall.
    antecedent_values = []

    for offset in range(72, 0, -1):
        expected_timestamp = (
            datetime.combine(target_date, datetime.min.time())
            - timedelta(hours=offset)
        )
        index = timestamp_to_index.get(expected_timestamp)

        if index is None:
            antecedent_values = []
            break

        value = _get_hourly_value(precipitation, index)

        if value is None:
            antecedent_values = []
            break

        antecedent_values.append(value)

    antecedent_rainfall = (
        sum(antecedent_values)
        if len(antecedent_values) == 72
        else None
    )

    moisture_values = []

    if isinstance(soil_moisture, list):
        for index in target_indices:
            value = _get_hourly_value(soil_moisture, index)

            if value is None:
                moisture_values = []
                break

            moisture_values.append(value)

    soil_moisture_pct = None

    if len(moisture_values) == len(target_indices) and moisture_values:
        # Open-Meteo reports volumetric soil moisture as a fraction.
        # Convert the fraction to a percentage.
        soil_moisture_pct = (
            sum(moisture_values) / len(moisture_values) * 100
        )

    elevation = _valid_number(payload.get("elevation"))

    return {
        "latitude": latitude,
        "longitude": longitude,
        "rainfall_1h_mm": trailing_rainfall(1),
        "rainfall_3h_mm": trailing_rainfall(3),
        "rainfall_6h_mm": trailing_rainfall(6),
        "rainfall_24h_mm": trailing_rainfall(24),
        "antecedent_rainfall_3d_mm": antecedent_rainfall,
        "soil_moisture_pct": soil_moisture_pct,
        "elevation_m": elevation,
    }
