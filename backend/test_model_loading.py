from app.services.model_service import model_service

status = model_service.get_load_status()
print(status)

assert status["is_loaded"], (
    f"Model failed to load: {status['error']}"
)

print("SUCCESS: Trained model loaded.")
print("Expected features:", status["expected_features"])