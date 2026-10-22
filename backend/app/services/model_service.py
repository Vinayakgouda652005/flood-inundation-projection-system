
from pathlib import Path
import json
import joblib
import pandas as pd
import xgboost as xgb


# Project paths
BASE_DIR = Path(__file__).resolve().parents[1]
MODEL_DIR = BASE_DIR / "models"

PREPROCESSOR_PATH = MODEL_DIR / "flood_preprocessor.joblib"
XGBOOST_PATH = MODEL_DIR / "flood_xgb_model.json"
METADATA_PATH = MODEL_DIR / "model_metadata.json"


class ModelService:
    def __init__(self):
        self.preprocessor = None
        self.booster = None
        self.metadata = {}
        self.expected_features = []
        self.error = None

        self.load_model()

    def load_model(self):
        try:
            if not PREPROCESSOR_PATH.exists():
                raise FileNotFoundError(
                    f"Preprocessor not found: {PREPROCESSOR_PATH}"
                )

            if not XGBOOST_PATH.exists():
                raise FileNotFoundError(
                    f"XGBoost model not found: {XGBOOST_PATH}"
                )

            self.preprocessor = joblib.load(PREPROCESSOR_PATH)

            # Load native XGBoost model
            self.booster = xgb.Booster()
            self.booster.load_model(str(XGBOOST_PATH))

            if METADATA_PATH.exists():
                with open(METADATA_PATH, "r", encoding="utf-8") as file:
                    self.metadata = json.load(file)

            
            self.expected_features = self.metadata.get("feature_columns") or (
    self.preprocessor.feature_names_in_.tolist()
    if hasattr(self.preprocessor, "feature_names_in_")
    else []
)

            self.error = None
            print("Flood model and preprocessor loaded successfully.")

        except Exception as exc:
            self.preprocessor = None
            self.booster = None
            self.error = str(exc)
            print(f"Could not load flood model: {exc}")

    def get_load_status(self):
        return {
            "model_path": str(XGBOOST_PATH),
            "preprocessor_path": str(PREPROCESSOR_PATH),
            "is_loaded": (
                self.preprocessor is not None
                and self.booster is not None
            ),
            "expected_features": self.expected_features,
            "error": self.error,
        }

    def predict(self, input_df: pd.DataFrame):
        if self.preprocessor is None or self.booster is None:
            raise RuntimeError(
                f"Flood model is not loaded: {self.error}"
            )

        if not isinstance(input_df, pd.DataFrame):
            raise TypeError("Input must be a pandas DataFrame.")

        if input_df.empty:
            raise ValueError("Input DataFrame cannot be empty.")

        # Validate input feature names and order
        if self.expected_features:
            missing = [
                feature for feature in self.expected_features
                if feature not in input_df.columns
            ]

            if missing:
                raise ValueError(
                    f"Missing model features: {missing}"
                )

            input_df = input_df[self.expected_features]

        transformed = self.preprocessor.transform(input_df)

        dmatrix = xgb.DMatrix(transformed)

        probabilities = self.booster.predict(dmatrix)

        return {
            "flood_probability": float(probabilities[0]),
            "predicted_flood": int(probabilities[0] >= 0.5),
        }


model_service = ModelService()
