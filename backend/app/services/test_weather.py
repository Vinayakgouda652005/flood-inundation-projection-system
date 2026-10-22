
from datetime import date

from app.services.weather_provider import (
    fetch_weather_features,
    WeatherProviderError,
)


if __name__ == "__main__":
    try:
        features = fetch_weather_features(
            latitude=12.9716,
            longitude=77.5946,
            target_date=date.today(),
        )

        print("\nWeather API test result")
        print("-" * 35)

        for name, value in features.items():
            print(f"{name}: {value}")

        print("\nWeather provider request completed.")

    except WeatherProviderError as exc:
        print(f"\nWeather API error: {exc}")
