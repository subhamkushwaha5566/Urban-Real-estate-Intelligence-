"""
Urban Real Estate Intelligence - Synthetic Dataset Generator
============================================================
Generates a realistic property transactions dataset of 10,000 properties
based on the NetLogo housing market model parameters, distributed across
five metro micro-markets.
"""

import numpy as np
import pandas as pd
import os

np.random.seed(42)

NUM_PROPERTIES = 10_000

# ---------------------------------------------------------------------------
# 1.  Micro-market definitions (inspired by Amsterdam / Dutch metro layout)
# ---------------------------------------------------------------------------
MICRO_MARKETS = {
    "Center":  {"lat_center": 52.370, "lon_center": 4.895, "premium": 1.40, "amenity_density": 0.92, "tax_rate": 0.0045},
    "South":   {"lat_center": 52.340, "lon_center": 4.880, "premium": 1.25, "amenity_density": 0.78, "tax_rate": 0.0042},
    "East":    {"lat_center": 52.365, "lon_center": 4.940, "premium": 1.10, "amenity_density": 0.65, "tax_rate": 0.0040},
    "West":    {"lat_center": 52.375, "lon_center": 4.840, "premium": 1.05, "amenity_density": 0.60, "tax_rate": 0.0038},
    "North":   {"lat_center": 52.400, "lon_center": 4.910, "premium": 0.90, "amenity_density": 0.45, "tax_rate": 0.0035},
}

MARKET_NAMES = list(MICRO_MARKETS.keys())
MARKET_WEIGHTS = [0.15, 0.25, 0.25, 0.20, 0.15]  # distribution across markets

# ---------------------------------------------------------------------------
# 2.  Housing sector definitions (from NetLogo breeds.nls / init.nls)
# ---------------------------------------------------------------------------
SECTORS = ["Social Rental", "Private Rental", "Home Ownership"]
SECTOR_WEIGHTS = [0.51, 0.18, 0.31]  # from NetLogo slider defaults

# Size distributions (rooms: 2, 3, 4, 5)
SIZES = [2, 3, 4, 5]

# ---------------------------------------------------------------------------
# 3.  Generate properties
# ---------------------------------------------------------------------------
def generate_dataset():
    records = []

    for i in range(NUM_PROPERTIES):
        # --- Sector ---
        sector = np.random.choice(SECTORS, p=SECTOR_WEIGHTS)

        # --- Micro-market ---
        market_name = np.random.choice(MARKET_NAMES, p=MARKET_WEIGHTS)
        market = MICRO_MARKETS[market_name]

        # --- Location (jittered around market center) ---
        lat = market["lat_center"] + np.random.normal(0, 0.012)
        lon = market["lon_center"] + np.random.normal(0, 0.018)

        # --- Distance to city center (Center market center) ---
        center_lat, center_lon = 52.370, 4.895
        distance_to_center = np.sqrt((lat - center_lat)**2 + (lon - center_lon)**2) * 111  # rough km

        # --- House size (rooms) ---
        if sector == "Social Rental":
            size = np.random.choice(SIZES, p=[0.35, 0.30, 0.25, 0.10])
        elif sector == "Private Rental":
            size = np.random.choice(SIZES, p=[0.20, 0.30, 0.30, 0.20])
        else:
            size = np.random.choice(SIZES, p=[0.10, 0.25, 0.35, 0.30])

        # --- Quality score (0-1) ---
        if sector == "Social Rental":
            quality = np.random.uniform(0.0, 1.0)
        elif sector == "Private Rental":
            quality = np.random.uniform(0.5, 1.0)
        else:
            quality = np.random.uniform(0.0, 1.0)

        # --- Age of building (years) ---
        building_age = int(np.clip(np.random.exponential(30), 1, 120))

        # --- Floor area (m²) based on rooms ---
        floor_area = size * np.random.uniform(18, 32) + np.random.normal(10, 5)
        floor_area = max(25, round(floor_area, 1))

        # --- Amenity density (from market + noise) ---
        amenity_density = np.clip(market["amenity_density"] + np.random.normal(0, 0.08), 0, 1)

        # --- Local tax rate ---
        tax_rate = market["tax_rate"] + np.random.normal(0, 0.0003)

        # --- Income zone rating (1-5) ---
        income_zone = np.clip(int(np.round(market["premium"] * 3 + np.random.normal(0, 0.5))), 1, 5)

        # --- Transit proximity score (0-1) ---
        transit_score = np.clip(1.0 - distance_to_center / 8.0 + np.random.normal(0, 0.1), 0, 1)

        # --- Green space ratio (0-1) ---
        green_space = np.clip(0.3 + np.random.normal(0, 0.15) + (0.1 if market_name == "North" else 0), 0, 1)

        # --- Crime index (0-1, lower is better) ---
        crime_index = np.clip(0.3 - market["premium"] * 0.1 + np.random.normal(0, 0.12), 0, 1)

        # --- School rating (1-10) ---
        school_rating = np.clip(round(market["premium"] * 5 + np.random.normal(0, 1.5), 1), 1, 10)

        # --- Noise level (dB, 30-80) ---
        noise_level = np.clip(45 + distance_to_center * 2 + np.random.normal(0, 8), 30, 80)

        # --- Energy efficiency label (A-G as numeric 1-7) ---
        if building_age < 10:
            energy_label = np.random.choice([1, 2, 3], p=[0.5, 0.3, 0.2])
        elif building_age < 30:
            energy_label = np.random.choice([2, 3, 4, 5], p=[0.2, 0.4, 0.3, 0.1])
        else:
            energy_label = np.random.choice([3, 4, 5, 6, 7], p=[0.1, 0.2, 0.3, 0.25, 0.15])

        # --- Parking availability (0 or 1) ---
        parking = int(np.random.random() < (0.3 + market["premium"] * 0.2))

        # --- Has balcony ---
        has_balcony = int(np.random.random() < (0.4 + quality * 0.3))

        # --- Renovation year ---
        last_renovation = max(2024 - building_age, 2024 - building_age + int(np.random.exponential(10)))
        last_renovation = min(last_renovation, 2024)

        # ---------------------------------------------------------------
        # VALUATION (target variable)
        # ---------------------------------------------------------------
        if sector == "Social Rental":
            base_price = 150_000 + quality * 80_000
        elif sector == "Private Rental":
            base_price = 220_000 + quality * 120_000
        else:  # Home Ownership — from init.nls price brackets, determined by size and quality
            # Determine bracket based on quality and floor area
            score = 0.5 * quality + 0.5 * ((floor_area - 25) / 175)
            bracket = np.clip(score + np.random.normal(0, 0.05), 0, 1)
            if bracket < 0.20:
                base_price = 121_000 + quality * 50_000
            elif bracket < 0.45:
                base_price = 221_000 + quality * 60_000
            elif bracket < 0.65:
                base_price = 310_000 + quality * 75_000
            elif bracket < 0.85:
                base_price = 385_000 + quality * 90_000
            else:
                base_price = 511_000 + quality * 150_000

        # Apply modifiers
        valuation = base_price
        valuation *= market["premium"]                          # location premium
        valuation *= (1 + (size - 2) * 0.08)                   # size bonus
        valuation *= (1 + floor_area / 500)                     # floor area effect
        valuation *= (1 - building_age * 0.0015)                # depreciation
        valuation *= (1 + amenity_density * 0.12)               # amenities boost
        valuation *= (1 + transit_score * 0.08)                 # transit boost
        valuation *= (1 - crime_index * 0.05)                   # crime penalty
        valuation *= (1 + (1 - energy_label / 7) * 0.06)       # energy bonus
        valuation *= (1 + parking * 0.03)                       # parking premium
        valuation *= (1 + has_balcony * 0.02)                   # balcony premium
        valuation *= np.random.uniform(0.95, 1.05)              # market noise (narrower for cleaner data)

        valuation = round(valuation, -2)  # round to nearest 100

        records.append({
            "property_id": f"PROP-{i+1:05d}",
            "micro_market": market_name,
            "sector": sector,
            "latitude": round(lat, 6),
            "longitude": round(lon, 6),
            "distance_to_center_km": round(distance_to_center, 2),
            "rooms": size,
            "floor_area_m2": floor_area,
            "quality_score": round(quality, 4),
            "building_age_years": building_age,
            "amenity_density": round(amenity_density, 4),
            "local_tax_rate": round(tax_rate, 6),
            "income_zone_rating": income_zone,
            "transit_proximity_score": round(transit_score, 4),
            "green_space_ratio": round(green_space, 4),
            "crime_index": round(crime_index, 4),
            "school_rating": school_rating,
            "noise_level_db": round(noise_level, 1),
            "energy_label": energy_label,
            "parking_available": parking,
            "has_balcony": has_balcony,
            "last_renovation_year": last_renovation,
            "valuation_eur": valuation,
        })

    df = pd.DataFrame(records)
    return df


if __name__ == "__main__":
    output_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(output_dir, "real_estate_dataset.csv")

    print("Generating dataset...")
    df = generate_dataset()
    df.to_csv(output_path, index=False)
    print(f"Dataset saved: {output_path}")
    print(f"Shape: {df.shape}")
    print(f"\nColumns: {list(df.columns)}")
    print(f"\nSample:\n{df.head()}")
    print(f"\nValuation stats:\n{df['valuation_eur'].describe()}")
    print(f"\nMicro-market distribution:\n{df['micro_market'].value_counts()}")
    print(f"\nSector distribution:\n{df['sector'].value_counts()}")
