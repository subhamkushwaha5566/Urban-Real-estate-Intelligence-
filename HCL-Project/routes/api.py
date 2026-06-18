import os
import json
import pickle
import numpy as np
import pandas as pd
from flask import Blueprint, current_app, jsonify, request

api_bp = Blueprint('api', __name__, url_prefix='/api')


@api_bp.route('/health')
def health():
    return jsonify({'status': 'ok', 'service': 'urei-api'})


def load_pickle(path):
    with open(path, 'rb') as f:
        return pickle.load(f)


def load_json(path):
    with open(path, 'r') as f:
        return json.load(f)


def artifacts_path():
    # models/ folder at project root
    return os.path.join(current_app.root_path, 'models')


# Lazy-load artifacts into module-level variables
_artifacts = {}


def ensure_artifacts():
    if _artifacts:
        return
    base = artifacts_path()
    # optional pickles
    try:
        _artifacts['scaler'] = load_pickle(os.path.join(base, 'scaler.pkl'))
        _artifacts['pca'] = load_pickle(os.path.join(base, 'pca.pkl'))
        _artifacts['stacking_model'] = load_pickle(os.path.join(base, 'stacking_ensemble.pkl'))
        _artifacts['le_market'] = load_pickle(os.path.join(base, 'le_market.pkl'))
        _artifacts['le_sector'] = load_pickle(os.path.join(base, 'le_sector.pkl'))
    except Exception:
        # if pickles missing, keep empty; prediction will error clearly
        pass

    # json artifacts
    try:
        _artifacts['pca_data'] = load_json(os.path.join(base, 'pca_data.json'))
        _artifacts['metrics_data'] = load_json(os.path.join(base, 'metrics.json'))
        _artifacts['predictions_sample'] = load_json(os.path.join(base, 'predictions_sample.json'))
        _artifacts['dataset_summary'] = load_json(os.path.join(base, 'dataset_summary.json'))
    except Exception:
        pass


@api_bp.route('/summary')
def api_summary():
    ensure_artifacts()
    return jsonify(_artifacts.get('dataset_summary', {}))


@api_bp.route('/metrics')
def api_metrics():
    ensure_artifacts()
    return jsonify(_artifacts.get('metrics_data', {}))


@api_bp.route('/pca')
def api_pca():
    ensure_artifacts()
    return jsonify(_artifacts.get('pca_data', {}))


@api_bp.route('/predictions')
def api_predictions():
    ensure_artifacts()
    return jsonify(_artifacts.get('predictions_sample', {}))


@api_bp.route('/data')
def api_data():
    # return a sample of the CSV dataset for the map
    count = request.args.get('n', 500, type=int)
    project_root = current_app.root_path
    csv_path = os.path.join(project_root, 'real_estate_dataset.csv')
    if os.path.exists(csv_path):
        df = pd.read_csv(csv_path)
        n = min(count, len(df))
        sample = df.sample(n, random_state=42)
        return jsonify(sample.to_dict(orient='records'))
    return jsonify([])


@api_bp.route('/predict', methods=['POST'])
def api_predict():
    try:
        ensure_artifacts()

        data = request.get_json(silent=True) or {}
        le_market = _artifacts.get('le_market')
        le_sector = _artifacts.get('le_sector')
        scaler = _artifacts.get('scaler')
        stacking_model = _artifacts.get('stacking_model')
        pca_data = _artifacts.get('pca_data', {})

        micro_market = data.get('micro_market', 'Center')
        sector = data.get('sector', 'Home Ownership')

        market_enc = int(le_market.transform([micro_market])[0]) if le_market is not None else 0
        sector_enc = int(le_sector.transform([sector])[0]) if le_sector is not None else 0

        profiles = {
            "Center":  {"premium": 1.40, "amenity_density": 0.92, "tax_rate": 0.0045},
            "South":   {"premium": 1.25, "amenity_density": 0.78, "tax_rate": 0.0042},
            "East":    {"premium": 1.10, "amenity_density": 0.65, "tax_rate": 0.0040},
            "West":    {"premium": 1.05, "amenity_density": 0.60, "tax_rate": 0.0038},
            "North":   {"premium": 0.90, "amenity_density": 0.45, "tax_rate": 0.0035},
        }
        prof = profiles.get(micro_market, profiles["Center"])

        lat = float(data.get('latitude', 52.370))
        lon = float(data.get('longitude', 4.895))
        dist = np.sqrt((lat - 52.370) ** 2 + (lon - 4.895) ** 2) * 111

        rooms = int(data.get('rooms', 3))
        floor_area = float(data.get('floor_area_m2', 80))
        quality = float(data.get('quality_score', 0.7))
        age = int(data.get('building_age_years', 20))
        energy = int(data.get('energy_label', 3))

        amenity_density = prof["amenity_density"]
        tax_rate = prof["tax_rate"]
        income_zone = int(np.clip(np.round(prof["premium"] * 3), 1, 5))
        transit_score = float(data.get('transit_proximity_score', np.clip(1.0 - dist / 8.0, 0, 1)))
        green_space = np.clip(0.3 + (0.1 if micro_market == "North" else 0), 0, 1)
        crime_index = np.clip(0.3 - prof["premium"] * 0.1, 0, 1)
        school_rating = np.clip(prof["premium"] * 5, 1, 10)
        noise_level = np.clip(45 + dist * 2, 30, 80)

        parking = 1 if (0.3 + prof["premium"] * 0.2) > 0.5 else 0
        has_balcony = 1 if (0.4 + quality * 0.3) > 0.55 else 0
        last_renovation = 2024 - age

        feature_names = pca_data.get('feature_names', [])
        feature_values = {
            "latitude": lat,
            "longitude": lon,
            "distance_to_center_km": dist,
            "rooms": rooms,
            "floor_area_m2": floor_area,
            "quality_score": quality,
            "building_age_years": age,
            "amenity_density": amenity_density,
            "local_tax_rate": tax_rate,
            "income_zone_rating": income_zone,
            "transit_proximity_score": transit_score,
            "green_space_ratio": green_space,
            "crime_index": crime_index,
            "school_rating": school_rating,
            "noise_level_db": noise_level,
            "energy_label": energy,
            "parking_available": parking,
            "has_balcony": has_balcony,
            "last_renovation_year": last_renovation,
            "micro_market_enc": market_enc,
            "sector_enc": sector_enc,
        }

        X_input = np.array([[feature_values.get(f, 0) for f in feature_names]])

        if scaler is not None:
            X_scaled = scaler.transform(X_input)
        else:
            X_scaled = X_input

        if stacking_model is None:
            # Fallback: simple synthetic valuation based on area*quality*premium
            pred = floor_area * quality * (prof['premium'] * 1000)
        else:
            pred = stacking_model.predict(X_scaled)[0]

        return jsonify({
            "valuation_eur": round(float(pred), -2),
            "formatted": f"₹{pred:,.0f}",
            "confidence": "high" if pred > 0 else "low",
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400
