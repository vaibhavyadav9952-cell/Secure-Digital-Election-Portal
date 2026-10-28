# isolation_forest_model.py
# This script trains and tests our Isolation Forest ML model.
# Run this separately to retrain the model with new data.
# Written by: Team FEP-CS-2024

import numpy as np
import pandas as pd
import os
import joblib
from sklearn.ensemble import IsolationForest
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

# Path to save the model
MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.pkl")
CSV_PATH = os.path.join(os.path.dirname(__file__), "sample_training_data.csv")


def prepare_training_data():
    """
    Prepare training data.
    If CSV exists, load it. Otherwise, create synthetic data.
    
    Features:
    - face_confidence: 0-100 (higher is better/normal)
    - login_hour: 0-23 (most normal logins happen during day)
    - time_to_vote: seconds (very fast or very slow is suspicious)
    - failed_login_count: how many wrong attempts (0 is normal)
    - is_duplicate: 0 or 1 (1 = already voted, clearly fraud)
    """
    if os.path.exists(CSV_PATH):
        print(f"Loading training data from {CSV_PATH}")
        df = pd.read_csv(CSV_PATH)
        X = df[["face_confidence", "login_hour", "time_to_vote", 
                "failed_login_count", "is_duplicate"]].values
        # Labels are for evaluation only (Isolation Forest is unsupervised)
        y = df["label"].values if "label" in df.columns else None
        return X, y
    else:
        print("No CSV found. Generating synthetic training data...")
        return generate_synthetic_data()


def generate_synthetic_data():
    """
    Generate fake but realistic training data.
    
    Normal patterns: high confidence, daytime hours, moderate voting time.
    Fraud patterns: low confidence, odd hours, extreme times, failures.
    """
    np.random.seed(42)   # For reproducible results
    
    # Normal voting behavior (200 samples)
    normal_samples = []
    for _ in range(200):
        sample = [
            np.random.uniform(75, 100),   # face_confidence: high
            np.random.randint(8, 20),      # login_hour: business hours
            np.random.uniform(30, 300),    # time_to_vote: 30 sec to 5 min
            0,                             # failed_login_count: 0
            0                              # is_duplicate: no
        ]
        normal_samples.append(sample)
    
    # Suspicious behavior (50 samples)
    suspicious_samples = []
    for _ in range(50):
        sample = [
            np.random.uniform(0, 50),      # face_confidence: low
            np.random.choice([0, 1, 2, 22, 23]),  # midnight hours
            np.random.choice([
                np.random.uniform(0, 5),   # too fast (bot?)
                np.random.uniform(3600, 7200)  # too slow (distracted?)
            ]),
            np.random.randint(3, 10),      # multiple failed attempts
            np.random.randint(0, 2)        # may or may not be duplicate
        ]
        suspicious_samples.append(sample)
    
    X_normal = np.array(normal_samples)
    X_suspicious = np.array(suspicious_samples)
    X = np.vstack([X_normal, X_suspicious])
    
    # Labels: 1=normal, -1=fraud (for evaluation)
    y = np.concatenate([np.ones(200), -np.ones(50)])
    
    return X, y


def train_model(X):
    """
    Train the Isolation Forest model.
    
    Isolation Forest works by:
    1. Randomly selecting a feature
    2. Randomly selecting a split value between min and max
    3. Repeating until the point is isolated
    4. Anomalies get isolated faster (shorter path length)
    
    contamination=0.15: We expect about 15% of data to be anomalies.
    n_estimators=100: We build 100 isolation trees.
    """
    model = IsolationForest(
        n_estimators=100,
        contamination=0.15,
        max_features=5,
        random_state=42,
        verbose=0
    )
    model.fit(X)
    print("Isolation Forest model trained successfully!")
    return model


def evaluate_model(model, X, y=None):
    """
    Quick evaluation of the model on training data.
    Since Isolation Forest is unsupervised, formal evaluation is limited.
    """
    predictions = model.predict(X)  # 1 = normal, -1 = anomaly
    scores = model.score_samples(X)  # Anomaly scores
    
    normal_count = np.sum(predictions == 1)
    anomaly_count = np.sum(predictions == -1)
    
    print(f"\nModel Predictions on Training Data:")
    print(f"  Normal: {normal_count} samples")
    print(f"  Anomaly: {anomaly_count} samples")
    print(f"  Anomaly Rate: {anomaly_count/len(X)*100:.1f}%")
    print(f"  Score Range: {scores.min():.4f} to {scores.max():.4f}")
    
    if y is not None:
        # If we have labels, show how well we detected known fraud
        correct = np.sum(predictions == y)
        print(f"\n  Accuracy against labels: {correct/len(y)*100:.1f}%")


def save_model(model):
    """Save the trained model to a .pkl file."""
    joblib.dump(model, MODEL_PATH)
    print(f"\nModel saved to: {MODEL_PATH}")


def test_predictions(model):
    """
    Test the model with a few example cases to make sure it works.
    This is useful for verifying the model during viva.
    """
    print("\nTesting Model with Example Cases:")
    print("-" * 40)
    
    test_cases = [
        ([92, 10, 120, 0, 0], "Normal user - high confidence, daytime"),
        ([40, 2, 5, 5, 1], "Fraud - low confidence, midnight, failed logins, duplicate"),
        ([85, 14, 180, 0, 0], "Normal user - good confidence, afternoon"),
        ([25, 1, 3, 8, 1], "High Risk Fraud - very suspicious"),
        ([70, 11, 90, 1, 0], "Borderline - medium confidence, one failure"),
    ]
    
    for features, description in test_cases:
        X_test = np.array([features])
        pred = model.predict(X_test)[0]
        score = model.score_samples(X_test)[0]
        result = "NORMAL" if pred == 1 else "ANOMALY (Fraud)"
        print(f"  {description}")
        print(f"    Result: {result}, Score: {score:.4f}")
        print()


if __name__ == "__main__":
    print("=" * 50)
    print("Isolation Forest - Fraud Detection Model Training")
    print("=" * 50)
    
    # Load or generate data
    X, y = prepare_training_data()
    print(f"Training data: {X.shape[0]} samples, {X.shape[1]} features")
    
    # Train the model
    print("\nTraining Isolation Forest model...")
    model = train_model(X)
    
    # Evaluate
    evaluate_model(model, X, y)
    
    # Test with examples
    test_predictions(model)
    
    # Save
    save_model(model)
    
    print("\nDone! Model is ready for fraud detection.")
