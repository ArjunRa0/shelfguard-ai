import os
import statistics
import tempfile

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from inference_sdk import InferenceConfiguration, InferenceHTTPClient

load_dotenv()

WORKSPACE = "arjuns-workspace-v2lor"
WORKFLOW_ID = "retail-shelf-product-and-empty-space-counts-1792527242989"
EDGE_ROI_PX = 60  # boxes whose left edge is inside this band are treated as glass reflections
EMPTY_KEYWORDS = ("empty", "gap", "space")

client = InferenceHTTPClient(
    api_url="https://serverless.roboflow.com",
    api_key=os.getenv("ROBOFLOW_API_KEY", "YOUR_ROBOFLOW_API_KEY"),
).configure(InferenceConfiguration(api_key_transport="header"))

app = FastAPI(title="ShelfGuard AI")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def unwrap_predictions(value):
    """Workflow outputs may be a bare list or {"image": {...}, "predictions": [...]}."""
    if isinstance(value, dict):
        value = value.get("predictions", [])
    return value if isinstance(value, list) else []


def unwrap_image(value):
    if isinstance(value, dict):
        return value.get("value")
    return value


def is_empty_class(name: str) -> bool:
    name = (name or "").lower()
    return any(k in name for k in EMPTY_KEYWORDS)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/analyze-shelf")
def analyze_shelf(file: UploadFile = File(...)):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload an image file.")

    suffix = os.path.splitext(file.filename or "")[1] or ".jpg"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file.file.read())
        temp_file_path = tmp.name

    try:
        result = client.run_workflow(
            workspace_name=WORKSPACE,
            workflow_id=WORKFLOW_ID,
            images={"image": temp_file_path},
            use_cache=True,
        )
    except Exception as exc:  # surface Roboflow errors to the UI
        raise HTTPException(status_code=502, detail=f"Roboflow workflow failed: {exc}")
    finally:
        try:
            os.remove(temp_file_path)
        except OSError:
            pass

    out = result[0] if isinstance(result, list) and result else (result or {})
    predictions = [dict(p) for p in unwrap_predictions(out.get("predictions"))]

    products = [p for p in predictions if not is_empty_class(p.get("class", ""))]
    areas = [p["width"] * p["height"] for p in products]
    # Adaptive default: boxes at least 55% of the median area are front-row facings.
    area_threshold = round(0.55 * statistics.median(areas)) if areas else 0

    for p in predictions:
        p["area"] = p["width"] * p["height"]
        if is_empty_class(p.get("class", "")):
            p["classification"] = "empty_gap"
        elif p["x"] - p["width"] / 2 < EDGE_ROI_PX:
            p["classification"] = "reflection_noise"
        elif p["area"] >= area_threshold:
            p["classification"] = "front_row_facing"
        else:
            p["classification"] = "back_row_depth"

    def count(label):
        return sum(1 for p in predictions if p["classification"] == label)

    empty_gaps = count("empty_gap")
    raw_empty = out.get("empty_space_count", empty_gaps)
    return {
        "raw_counts": {
            "product_count": out.get("product_count", len(products)),
            "empty_space_count": raw_empty,
        },
        "filtered_counts": {
            "front_row_facings": count("front_row_facing"),
            "back_row_depth": count("back_row_depth"),
            "empty_space_count": raw_empty,
            "reflection_noise": count("reflection_noise"),
        },
        "settings": {"edge_roi_px": EDGE_ROI_PX, "suggested_min_area": area_threshold},
        "predictions": predictions,
        "output_image": unwrap_image(out.get("output_image")),
    }
