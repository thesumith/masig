from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from signal_analysis import analyze_excel, get_excel_metadata

app = FastAPI(title="API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/excel-metadata")
async def excel_metadata(file: UploadFile = File(...)):
    """Parse upload and return distinct drugs and date range for the UI."""
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(
            status_code=400,
            detail="Upload an Excel file (.xlsx or .xlsm).",
        )
    content = await file.read()
    try:
        return get_excel_metadata(content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/analyze-signals")
async def analyze_signals(
    file: UploadFile = File(...),
    drug_name: str = Form(""),
    review_period_start: str = Form(""),
    review_period_end: str = Form(""),
):
    """
    Upload an Excel (.xlsx) file with columns including:
    Case ID, Initial Report Date, Suspected Product, Adverse Event (PT).

    Optional: filter by suspected product (drug) and review period (Initial Report Date
    per case, earliest date in the file). Returns PRR, ROR, chi-square, and EBGM.
    """
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(
            status_code=400,
            detail="Upload an Excel file (.xlsx or .xlsm).",
        )
    content = await file.read()
    try:
        return analyze_excel(
            content,
            drug_name=drug_name or None,
            period_start=review_period_start or None,
            period_end=review_period_end or None,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

