"""
Pharmacovigilance disproportionality metrics from case-level 2x2 tables.

For each drug–event pair (D, E):
  a = cases containing both D and E (co-occurrence within the same case)
  b = cases with D but not E
  c = cases with E but not D
  d = cases with neither D nor E

PRR = [a/(a+b)] / [c/(c+d)]
ROR = (a*d) / (b*c)
Chi-square = Pearson chi-square on [[a,b],[c,d]] (no Yates unless noted)
EBGM = empirical Bayes shrinkage of O/E using (O + α) / (E + α), α = 0.5
       (common Bayesian/Gamma–Poisson style prior; E = (a+b)(a+c)/N)
"""

from __future__ import annotations

import math
from io import BytesIO
from typing import Any

import numpy as np
import pandas as pd
from scipy.stats import chi2_contingency

# Expected column names (after normalization) — user-facing labels mapped here
REQUIRED_COLUMNS = (
    "case_id",
    "initial_report_date",
    "suspected_product",
    "adverse_event_pt",
)

# Aliases: lowercase stripped key -> canonical
COLUMN_ALIASES: dict[str, str] = {
    "case id": "case_id",
    "caseid": "case_id",
    "initial report date": "initial_report_date",
    "report date": "initial_report_date",
    "suspected product": "suspected_product",
    "product": "suspected_product",
    "drug": "suspected_product",
    "adverse event (pt)": "adverse_event_pt",
    "adverse event": "adverse_event_pt",
    "pt": "adverse_event_pt",
    "preferred term": "adverse_event_pt",
}


def _normalize_col(name: str) -> str:
    s = str(name).strip().lower()
    s = " ".join(s.split())
    return COLUMN_ALIASES.get(s, s.replace(" ", "_"))


def normalize_dataframe_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out.columns = [_normalize_col(c) for c in out.columns]
    return out


def _case_id_str(x: Any) -> str:
    if pd.isna(x):
        return ""
    try:
        f = float(str(x).replace(",", ""))
        if math.isfinite(f) and f == int(f):
            return str(int(f))
    except (ValueError, TypeError, OverflowError):
        pass
    return str(x).strip()


def read_cases_from_excel(content: bytes) -> pd.DataFrame:
    df = pd.read_excel(BytesIO(content), engine="openpyxl")
    df = normalize_dataframe_columns(df)
    missing = [r for r in REQUIRED_COLUMNS if r not in df.columns]
    if missing:
        raise ValueError(
            "Missing required columns (after normalization): "
            + ", ".join(missing)
            + ". Found columns: "
            + ", ".join(map(str, df.columns))
        )
    slim = pd.DataFrame(
        {
            "case_id": df["case_id"].apply(_case_id_str),
            "initial_report_date": pd.to_datetime(df["initial_report_date"], errors="coerce"),
            "suspected_product": df["suspected_product"].astype(str).str.strip(),
            "adverse_event_pt": df["adverse_event_pt"].astype(str).str.strip(),
        }
    )
    slim = slim[
        (slim["case_id"] != "")
        & (slim["case_id"].str.lower() != "nan")
        & (slim["suspected_product"] != "")
        & (slim["suspected_product"].str.lower() != "nan")
        & (slim["adverse_event_pt"] != "")
        & (slim["adverse_event_pt"].str.lower() != "nan")
    ]
    return slim


def _case_drug_event_sets(slim: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, set[str]], dict[str, set[str]]]:
    """Per case: earliest initial report date, set of drugs, set of events."""
    def min_date(series: pd.Series) -> Any:
        valid = series.dropna()
        return valid.min() if len(valid) else pd.NaT

    agg = slim.groupby("case_id", as_index=False).agg(
        initial_report_date=("initial_report_date", min_date),
        drugs=("suspected_product", lambda s: set(s.unique())),
        events=("adverse_event_pt", lambda s: set(s.unique())),
    )
    case_drugs = dict(zip(agg["case_id"], agg["drugs"], strict=True))
    case_events = dict(zip(agg["case_id"], agg["events"], strict=True))
    return agg, case_drugs, case_events


def contingency_for_pair(
    drug: str,
    event: str,
    case_drugs: dict[str, set[str]],
    case_events: dict[str, set[str]],
) -> tuple[int, int, int, int]:
    a = b = c = d = 0
    for cid in case_drugs:
        has_d = drug in case_drugs[cid]
        has_e = event in case_events[cid]
        if has_d and has_e:
            a += 1
        elif has_d and not has_e:
            b += 1
        elif not has_d and has_e:
            c += 1
        else:
            d += 1
    return a, b, c, d


def prr_ror_chi2_ebgm(
    a: int, b: int, c: int, d: int, alpha: float = 0.5
) -> dict[str, float | None]:
    n = a + b + c + d
    # Expected count for cell (D,E) under independence
    e_de = (a + b) * (a + c) / n if n > 0 else float("nan")

    prr = None
    if (a + b) > 0 and (c + d) > 0 and c > 0:
        prr = (a / (a + b)) / (c / (c + d))

    ror = None
    if b > 0 and c > 0:
        ror = (a * d) / (b * c)

    chi2 = None
    chi2_p = None
    if a + b > 0 and c + d > 0 and a + c > 0 and b + d > 0:
        table = np.array([[a, b], [c, d]], dtype=float)
        chi2_res = chi2_contingency(table, correction=False)
        chi2 = float(chi2_res[0])
        chi2_p = float(chi2_res[1])

    ebgm = None
    if not math.isnan(e_de) and e_de >= 0:
        ebgm = (a + alpha) / (e_de + alpha)

    return {
        "prr": prr,
        "ror": ror,
        "chi_square": chi2,
        "chi_square_p_value": chi2_p,
        "ebgm": ebgm,
        "expected_count": float(e_de) if not math.isnan(e_de) else None,
        "n_cases": int(n),
    }


def enumerate_drug_event_pairs(slim: pd.DataFrame) -> set[tuple[str, str]]:
    pairs: set[tuple[str, str]] = set()
    for _, row in slim.iterrows():
        pairs.add((row["suspected_product"], row["adverse_event_pt"]))
    return pairs


def _parse_optional_date(value: str | None) -> pd.Timestamp | None:
    if value is None or not str(value).strip():
        return None
    t = pd.to_datetime(str(value).strip(), errors="coerce")
    if pd.isna(t):
        raise ValueError(f"Invalid date: {value!r}")
    return t.normalize()


def _filter_slim_by_review_period(
    slim: pd.DataFrame,
    period_start: pd.Timestamp | None,
    period_end: pd.Timestamp | None,
) -> pd.DataFrame:
    """Keep only cases whose earliest Initial Report Date falls within [start, end] (inclusive)."""
    if period_start is None and period_end is None:
        return slim

    agg0, _, _ = _case_drug_event_sets(slim)
    ir = pd.to_datetime(agg0["initial_report_date"])
    mask = pd.Series(True, index=agg0.index)
    if period_start is not None:
        mask &= ir.dt.normalize() >= period_start
    if period_end is not None:
        mask &= ir.dt.normalize() <= period_end
    keep = set(agg0.loc[mask, "case_id"])
    out = slim[slim["case_id"].isin(keep)].copy()
    return out


def get_excel_metadata(content: bytes) -> dict[str, Any]:
    slim = read_cases_from_excel(content)
    if slim.empty:
        raise ValueError("No valid rows after parsing (need Case ID, drug, and event).")
    agg, _, _ = _case_drug_event_sets(slim)
    drugs = sorted(slim["suspected_product"].unique())
    dates = pd.to_datetime(agg["initial_report_date"], errors="coerce").dropna()
    min_d = dates.min() if len(dates) else None
    max_d = dates.max() if len(dates) else None
    return {
        "drugs": drugs,
        "min_date": min_d.isoformat() if pd.notna(min_d) else None,
        "max_date": max_d.isoformat() if pd.notna(max_d) else None,
        "total_cases": int(len(agg)),
        "total_rows": int(len(slim)),
    }


def analyze_excel(
    content: bytes,
    *,
    drug_name: str | None = None,
    period_start: str | None = None,
    period_end: str | None = None,
) -> dict[str, Any]:
    ps = _parse_optional_date(period_start)
    pe = _parse_optional_date(period_end)
    if ps is not None and pe is not None and ps > pe:
        raise ValueError("Review period start must be on or before end.")

    slim = read_cases_from_excel(content)
    if slim.empty:
        raise ValueError("No valid rows after parsing (need Case ID, drug, and event).")

    slim = _filter_slim_by_review_period(slim, ps, pe)
    if slim.empty:
        raise ValueError("No cases fall within the selected review period.")

    agg, case_drugs, case_events = _case_drug_event_sets(slim)
    pairs = enumerate_drug_event_pairs(slim)
    if drug_name is not None and str(drug_name).strip():
        d = str(drug_name).strip()
        pairs = {(p, e) for (p, e) in pairs if p == d}
    if not pairs:
        raise ValueError(
            "No drug–event pairs for the selected drug. Pick a drug from the list."
        )

    rows: list[dict[str, Any]] = []
    for drug, event in sorted(pairs):
        a, b, c, d = contingency_for_pair(drug, event, case_drugs, case_events)
        stats = prr_ror_chi2_ebgm(a, b, c, d)
        # Earliest report date among cases with this pair
        case_ids_with_pair = slim[
            (slim["suspected_product"] == drug) & (slim["adverse_event_pt"] == event)
        ]["case_id"].unique()
        dates = agg[agg["case_id"].isin(case_ids_with_pair)]["initial_report_date"]
        min_ir = dates.min() if len(dates) else None

        rows.append(
            {
                "suspected_product": drug,
                "adverse_event_pt": event,
                "a": a,
                "b": b,
                "c": c,
                "d": d,
                "initial_report_date_earliest": min_ir.isoformat() if pd.notna(min_ir) else None,
                **stats,
            }
        )

    return {
        "total_cases": int(len(agg)),
        "total_rows": int(len(slim)),
        "pairs_analyzed": len(rows),
        "signals": rows,
        "filters": {
            "drug_name": (str(drug_name).strip() or None) if drug_name is not None else None,
            "review_period_start": ps.isoformat() if ps is not None else None,
            "review_period_end": pe.isoformat() if pe is not None else None,
        },
    }
