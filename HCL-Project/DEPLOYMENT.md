# Deployment Guide — UREI (Frontend + Backend Split)

This project is split into:

| Part | Platform | Folder |
|------|----------|--------|
| **Frontend** (dashboard, login, register) | [Vercel](https://vercel.com) | `frontend/` |
| **Backend** (REST API + ML) | [Render](https://render.com) | project root |

---

## 1. Deploy Backend on Render

### Option A — Blueprint (recommended)

1. Push this repo to GitHub.
2. In Render → **New** → **Blueprint** → connect the repo.
3. Render reads `render.yaml` and creates:
   - Web service: `urei-api`
   - PostgreSQL database: `urei-db`
4. Render sets the production frontend origin from `render.yaml`:
   - `FRONTEND_URL` = `https://urei-chi.vercel.app`

### Option B — Manual Web Service

1. **New Web Service** → connect repo.
2. Settings:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `flask db upgrade && gunicorn wsgi:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120`
3. Environment variables:

| Variable | Value |
|----------|-------|
| `FLASK_CONFIG` | `production` |
| `FLASK_APP` | `wsgi:app` |
| `SECRET_KEY` | long random string |
| `DATABASE_URL` | PostgreSQL connection string |
| `FRONTEND_URL` | `https://urei-chi.vercel.app` |

4. Production API URL: `https://hcl-project-89ks.onrender.com`

### API endpoints

- `GET /api/health` — health check
- `GET /api/summary`, `/api/metrics`, `/api/pca`, `/api/predictions`, `/api/data`
- `POST /api/predict` — valuation prediction
- `POST /api/auth/register`, `/api/auth/login`
- `GET /api/auth/me` — current user (Bearer token)

---

## 2. Deploy Frontend on Vercel

1. Import the GitHub repo in Vercel.
2. Set **Root Directory** to `frontend`.
3. Add environment variable:

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://hcl-project-89ks.onrender.com` |

4. Deploy. Vercel runs `npm run build`; the frontend reads `VITE_API_URL` at build time.

### Routes

- `/` — dashboard
- `/login` — sign in
- `/register` — create account

---

## 3. Connect Frontend ↔ Backend

After both are live:

1. **Render:** set `FRONTEND_URL` to `https://urei-chi.vercel.app` (no trailing slash).
2. **Vercel:** set `VITE_API_URL` to `https://hcl-project-89ks.onrender.com` (no trailing slash).
3. Redeploy both services.

CORS is configured on the backend using `FRONTEND_URL`.

---

## 4. Development

### Backend

```bash
cd real_estate_project
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
flask db upgrade
python app.py
```

The deployed API runs at `https://hcl-project-89ks.onrender.com`.

### Frontend

```bash
cd frontend
npm install
npm run build
```

The deployed frontend runs at `https://urei-chi.vercel.app`.

---

## 5. Notes

- **Model files** (`models/*.pkl`) must be committed for Render to serve predictions.
- **Render free tier** spins down after inactivity; first request may take ~30s.
- **PostgreSQL** is required on Render for persistent user accounts (SQLite resets on redeploy).
- Auth uses **JWT tokens** stored in `localStorage` on the frontend.
