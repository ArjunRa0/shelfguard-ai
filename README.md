# Roboflow ShelfGuard AI — Real-Time Planogram & Stock Inspector

Computer vision models often break down when exposed to real-world store environments—glass door reflections trigger false positives, and 2D cameras struggle to tell customer-facing products apart from obscured back-row stock.

I built ShelfGuard AI to bridge that gap between raw model inference and actual retail operations. The full-stack app connects a custom Roboflow Workflow to a FastAPI backend and an interactive React dashboard, adding real-time post-processing logic to solve physical edge cases on the fly:

Facings vs. Depth Disambiguation: Implemented dynamic bounding-box area heuristics to separate front-row facings from partially hidden back-row stock in real time, preserving accurate visual compliance metrics without model retraining.

ROI Glare & Edge Filtering: Stripped out false detections caused by cooler glass reflections along the door edges.

Actionable Operational KPIs: Generated instant out-of-stock gap alerts and inventory counters directly over the interactive canvas overlay.

Tech Stack: Roboflow Workflows & Inference SDK, FastAPI, Python, React, Tailwind CSS.

```
backend/    FastAPI app (main.py, requirements.txt)
frontend/   React + Vite + Tailwind + lucide-react
```

## 1. Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then put your real ROBOFLOW_API_KEY in .env
uvicorn main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

## 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to `localhost:8000`. To point at a different backend, set `VITE_API_URL`.

## How post-processing works

`POST /api/analyze-shelf` returns `raw_counts`, `filtered_counts`, `settings`, `predictions` and base64 `output_image`. Each prediction gets a `classification`:

| Value | Rule |
|---|---|
| `reflection_noise` | `x - width/2 < 60` (left edge band, e.g. glass-door reflections) |
| `front_row_facing` | box area (`width * height`) ≥ threshold |
| `back_row_depth` | box area < threshold |
| `empty_gap` | class name contains `empty`, `gap` or `space` |

The default area threshold is 55% of the median product box area (returned as `settings.suggested_min_area`). In the UI, the toggles and the Min Box Area slider recompute classifications, KPIs, the table and the canvas overlay instantly in the browser no re-upload needed.

## Notes

- If your workflow names its empty-space class differently, adjust `EMPTY_KEYWORDS` in `backend/main.py`.
- Never commit `.env`; it holds your API key.
