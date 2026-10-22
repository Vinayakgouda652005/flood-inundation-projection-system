
from datetime import date

from app.services.weather_provider import (
    fetch_weather_features,
    WeatherProviderError,
)

latitude = 12.9716
longitude = 77.5946

# Test a recent historical date.
try:
    result = fetch_weather_features(
        latitude=latitude,
        longitude=longitude,
        target_date=date(2026, 10, 19),
    )

    print("Historical weather result:")
    for key, value in result.items():
        print(f"{key}: {value}")

except WeatherProviderError as exc:
    print("Historical weather unavailable:", exc)

# Test today's weather separately.
try:
    result = fetch_weather_features(
        latitude=latitude,
        longitude=longitude,
        target_date=date.today(),
    )

    print("\nToday's weather result:")
    for key, value in result.items():
        print(f"{key}: {value}")

except WeatherProviderError as exc:
    print("Today's weather unavailable:", exc)
