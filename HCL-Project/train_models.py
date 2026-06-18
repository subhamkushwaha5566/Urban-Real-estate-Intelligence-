"""
Urban Real Estate Intelligence - Model Training Pipeline
=========================================================
Performs PCA dimensionality reduction and trains ensemble regression
models (Random Forest, Gradient Boosting, AdaBoost, Stacking Regressor)
to estimate property valuations.
"""

import os
import json
import pickle
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.decomposition import PCA
from sklearn.ensemble import (
    RandomForestRegressor,
    GradientBoostingRegressor,
    AdaBoostRegressor,
    StackingRegressor,
    VotingRegressor,
)
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score


def load_and_prepare(csv_path):
    """Load dataset and encode categoricals."""
    df = pd.read_csv(csv_path)

    # Encode categorical columns
    le_market = LabelEncoder()
    le_sector = LabelEncoder()
    df["micro_market_enc"] = le_market.fit_transform(df["micro_market"])
    df["sector_enc"] = le_sector.fit_transform(df["sector"])

    # Features to use (drop id, raw categoricals, and target)
    drop_cols = ["property_id", "micro_market", "sector", "valuation_eur"]
    feature_cols = [c for c in df.columns if c not in drop_cols]

    X = df[feature_cols].values.astype(np.float64)
    y = df["valuation_eur"].values.astype(np.float64)

    return X, y, feature_cols, le_market, le_sector, df


def run_pipeline(project_dir):
    csv_path = os.path.join(project_dir, "real_estate_dataset.csv")
    models_dir = os.path.join(project_dir, "models")
    os.makedirs(models_dir, exist_ok=True)

    print("=" * 60)
    print("  URBAN REAL ESTATE INTELLIGENCE - TRAINING PIPELINE")
    print("=" * 60)

    # ------------------------------------------------------------------
    # 1. Load data
    # ------------------------------------------------------------------
    print("\n[1/5] Loading dataset...")
    X, y, feature_cols, le_market, le_sector, df = load_and_prepare(csv_path)
    print(f"  Features: {len(feature_cols)}")
    print(f"  Samples : {X.shape[0]}")

    # ------------------------------------------------------------------
    # 2. Train / Test split
    # ------------------------------------------------------------------
    print("\n[2/5] Splitting data (80/20)...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42
    )
    print(f"  Train: {X_train.shape[0]}, Test: {X_test.shape[0]}")

    # ------------------------------------------------------------------
    # 3. Scaling + PCA
    # ------------------------------------------------------------------
    print("\n[3/5] Scaling & PCA dimensionality reduction...")
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # Full PCA for analysis
    pca_full = PCA()
    pca_full.fit(X_train_scaled)
    cumulative_var = np.cumsum(pca_full.explained_variance_ratio_)

    # Choose n_components that explain >= 95% variance
    n_components = int(np.argmax(cumulative_var >= 0.95)) + 1
    print(f"  Components for 95% variance: {n_components} / {len(feature_cols)}")

    pca = PCA(n_components=n_components, random_state=42)
    X_train_pca = pca.fit_transform(X_train_scaled)
    X_test_pca = pca.transform(X_test_scaled)

    print(f"  Explained variance (selected): {pca.explained_variance_ratio_.sum():.4f}")

    # PCA loadings
    loadings = pd.DataFrame(
        pca.components_.T,
        index=feature_cols,
        columns=[f"PC{i+1}" for i in range(n_components)],
    )

    # ------------------------------------------------------------------
    # 4. Train models
    # ------------------------------------------------------------------
    print("\n[4/5] Training ensemble models...")

    models = {
        "Random Forest": RandomForestRegressor(
            n_estimators=200, max_depth=15, random_state=42, n_jobs=-1
        ),
        "Gradient Boosting": GradientBoostingRegressor(
            n_estimators=200, max_depth=6, learning_rate=0.1, random_state=42
        ),
        "AdaBoost": AdaBoostRegressor(
            n_estimators=150, learning_rate=0.05, random_state=42
        ),
    }

    results = {}

    for name, model in models.items():
        print(f"\n  Training {name}...")
        model.fit(X_train_scaled, y_train)
        y_pred = model.predict(X_test_scaled)

        r2 = r2_score(y_test, y_pred)
        rmse = np.sqrt(mean_squared_error(y_test, y_pred))
        mae = mean_absolute_error(y_test, y_pred)

        results[name] = {"r2": round(r2, 4), "rmse": round(rmse, 2), "mae": round(mae, 2)}
        print(f"    R²: {r2:.4f} | RMSE: ₹{rmse:,.0f} | MAE: ₹{mae:,.0f}")

    # Stacking Regressor
    print("\n  Training Stacking Ensemble...")
    stacking = StackingRegressor(
        estimators=[
            ("rf", RandomForestRegressor(n_estimators=200, max_depth=15, random_state=42, n_jobs=-1)),
            ("gb", GradientBoostingRegressor(n_estimators=200, max_depth=6, learning_rate=0.1, random_state=42)),
            ("ab", AdaBoostRegressor(n_estimators=150, learning_rate=0.05, random_state=42)),
        ],
        final_estimator=Ridge(alpha=1.0),
        cv=5,
        n_jobs=-1,
    )
    stacking.fit(X_train_scaled, y_train)
    y_pred_stack = stacking.predict(X_test_scaled)

    r2_s = r2_score(y_test, y_pred_stack)
    rmse_s = np.sqrt(mean_squared_error(y_test, y_pred_stack))
    mae_s = mean_absolute_error(y_test, y_pred_stack)

    results["Stacking Ensemble"] = {"r2": round(r2_s, 4), "rmse": round(rmse_s, 2), "mae": round(mae_s, 2)}
    print(f"    R²: {r2_s:.4f} | RMSE: ₹{rmse_s:,.0f} | MAE: ₹{mae_s:,.0f}")

    models["Stacking Ensemble"] = stacking

    # ------------------------------------------------------------------
    # 5. Save artifacts
    # ------------------------------------------------------------------
    print("\n[5/5] Saving models and metadata...")

    # Save models
    for name, model in models.items():
        fname = name.lower().replace(" ", "_") + ".pkl"
        with open(os.path.join(models_dir, fname), "wb") as f:
            pickle.dump(model, f)

    # Save scaler, PCA, encoders
    with open(os.path.join(models_dir, "scaler.pkl"), "wb") as f:
        pickle.dump(scaler, f)
    with open(os.path.join(models_dir, "pca.pkl"), "wb") as f:
        pickle.dump(pca, f)
    with open(os.path.join(models_dir, "le_market.pkl"), "wb") as f:
        pickle.dump(le_market, f)
    with open(os.path.join(models_dir, "le_sector.pkl"), "wb") as f:
        pickle.dump(le_sector, f)

    # Fast temporary Random Forest on PCA components to populate PCA loads feature importances in UI
    print("  Calculating PCA component importances...")
    rf_pca_temp = RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42, n_jobs=-1)
    rf_pca_temp.fit(X_train_pca, y_train)
    pca_importances = rf_pca_temp.feature_importances_.tolist()

    # Save PCA analysis data
    pca_data = {
        "n_components": n_components,
        "n_features_original": len(feature_cols),
        "feature_names": feature_cols,
        "explained_variance_ratio": pca.explained_variance_ratio_.tolist(),
        "cumulative_variance": cumulative_var.tolist(),
        "loadings": {col: loadings[col].to_dict() for col in loadings.columns},
        "pca_component_importances": pca_importances,
    }

    # Save model metrics
    metrics_data = {
        "results": results,
        "best_model": max(results, key=lambda k: results[k]["r2"]),
        "test_size": X_test.shape[0],
        "train_size": X_train.shape[0],
    }

    # Save a sample of actual vs predicted for the chart
    sample_idx = np.random.choice(len(y_test), size=min(200, len(y_test)), replace=False)
    predictions_sample = {
        "actual": y_test[sample_idx].tolist(),
        "predicted": y_pred_stack[sample_idx].tolist(),
    }

    # Save dataset summary for the dashboard
    dataset_summary = {
        "total_properties": len(df),
        "features_count": len(feature_cols),
        "micro_markets": df["micro_market"].value_counts().to_dict(),
        "sectors": df["sector"].value_counts().to_dict(),
        "valuation_stats": {
            "mean": round(df["valuation_eur"].mean(), 2),
            "median": round(df["valuation_eur"].median(), 2),
            "min": round(df["valuation_eur"].min(), 2),
            "max": round(df["valuation_eur"].max(), 2),
            "std": round(df["valuation_eur"].std(), 2),
        },
        "avg_valuation_by_market": df.groupby("micro_market")["valuation_eur"].mean().round(2).to_dict(),
        "avg_valuation_by_sector": df.groupby("sector")["valuation_eur"].mean().round(2).to_dict(),
    }

    with open(os.path.join(models_dir, "pca_data.json"), "w") as f:
        json.dump(pca_data, f, indent=2)
    with open(os.path.join(models_dir, "metrics.json"), "w") as f:
        json.dump(metrics_data, f, indent=2)
    with open(os.path.join(models_dir, "predictions_sample.json"), "w") as f:
        json.dump(predictions_sample, f, indent=2)
    with open(os.path.join(models_dir, "dataset_summary.json"), "w") as f:
        json.dump(dataset_summary, f, indent=2)

    print(f"\n  All artifacts saved to: {models_dir}")
    print("\n" + "=" * 60)
    print("  TRAINING COMPLETE")
    print("=" * 60)
    print(f"\n  Best model: {metrics_data['best_model']}")
    print(f"  Best R²:    {results[metrics_data['best_model']]['r2']}")
    print(f"  Best RMSE:  ₹{results[metrics_data['best_model']]['rmse']:,.0f}")

    return results


if __name__ == "__main__":
    project_dir = os.path.dirname(os.path.abspath(__file__))
    run_pipeline(project_dir)
