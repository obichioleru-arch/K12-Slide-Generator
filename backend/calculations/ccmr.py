"""
CCMR Calculator — production-ready.
The CCMR template title uses {{Campus}} for the district/campus name.
We always pass both 'District' and 'Campus' in slide_data.
"""
import pandas as pd

REQUIRED_FIELDS = {
    "ccmr_yoy_breakdown": [
        {"key": "year",       "label": "Class / Graduation Year",
         "description": "Column with the graduation year (e.g. 'Class')",
         "candidates": ["Class","Year","School Year","Reporting Year","Graduation Year"]},
        {"key": "tsi",        "label": "CCMR TSI Status",
         "description": "TSI CCMR indicator. Values: Met, Not Met, Approaches",
         "candidates": ["CCMR TSI Status","TSI Status","TSI","TSI Met"]},
        {"key": "ibc",        "label": "IBC / Certification Status",
         "description": "IBC or certification indicator. Values: Met, Not Met",
         "candidates": ["CCMR Certification Status","IBC Status","IBC","IBC Met","L1/L2 Certification"],
         "optional": True},
        {"key": "enrollment", "label": "CCMR Overall / Enrollment Status",
         "description": "Overall CCMR indicator. Values: Met, Not Met",
         "candidates": ["CCMR Overall Status","Enrollment Status","Postsecondary Enrollment Status"],
         "optional": True},
    ],
}


def _find_column(df, candidates):
    clean = {str(c).strip().lower(): c for c in df.columns}
    for cand in candidates:
        if cand.strip().lower() in clean:
            return clean[cand.strip().lower()]
    return None


def _resolve(df, overrides, field_defs):
    resolved, missing = {}, []
    for field in field_defs:
        key, optional = field["key"], field.get("optional", False)
        if key in overrides and overrides[key]:
            col = overrides[key]
            resolved[key] = col if col in df.columns else None
            continue
        col = _find_column(df, field["candidates"])
        if col: resolved[key] = col
        elif not optional: missing.append(field["label"])
    if missing:
        raise ValueError(f"Required columns not found: {', '.join(missing)}. Columns: {list(df.columns)}")
    return resolved


def _met_rate(df, col):
    if not col or col not in df.columns or len(df) == 0: return 0.0
    vals = df[col].astype(str).str.strip().str.lower()
    return round(vals.isin(["met","true","yes","y","1"]).sum() / len(df) * 100, 1)


def _met_count(df, col):
    if not col or col not in df.columns: return 0
    vals = df[col].astype(str).str.strip().str.lower()
    return int(vals.isin(["met","true","yes","y","1"]).sum())


def calculate_ccmr_yoy_breakdown(df: pd.DataFrame, overrides: dict = None,
                                  mode: str = "percent", aggregation_level: str = "district") -> dict:
    overrides = overrides or {}
    cols = _resolve(df, overrides, REQUIRED_FIELDS["ccmr_yoy_breakdown"])
    year_col       = cols["year"]
    tsi_col        = cols["tsi"]
    ibc_col        = cols.get("ibc")
    enrollment_col = cols.get("enrollment")

    # Get district name from data
    CAMPUS_CANDIDATES = ["Primary Educational Institution","Campus","Campus Name",
                         "School","School Name","_district_name","District","District Name"]
    dist_col = _find_column(df, CAMPUS_CANDIDATES)
    if "_district_display_name" in df.columns:
        vals = df["_district_display_name"].dropna().unique()
        district_name = str(vals[0]) if len(vals)==1 else ", ".join(sorted(str(v) for v in vals))
    elif "_district_name" in df.columns:
        vals = df["_district_name"].dropna().unique()
        district_name = ", ".join(sorted(str(v) for v in vals)) if len(vals) > 0 else "District"
    elif dist_col:
        district_name = str(df[dist_col].dropna().iloc[0])
    else:
        district_name = "District"

    df = df.copy()
    df["_yr"] = pd.to_numeric(df[year_col], errors="coerce")
    valid = sorted(df["_yr"][df["_yr"].between(2018, 2030)].dropna().unique())
    years = valid[-3:] if valid else [2023, 2024, 2025]
    while len(years) < 3: years.append("")

    tsi_v, ibc_v, enr_v = [], [], []
    for yr in years:
        if yr == "":
            tsi_v.append(0.0); ibc_v.append(0.0); enr_v.append(0.0)
            continue
        ydf = df[df["_yr"] == yr]
        fn = _met_rate if mode == "percent" else _met_count
        tsi_v.append(fn(ydf, tsi_col))
        ibc_v.append(fn(ydf, ibc_col))
        enr_v.append(fn(ydf, enrollment_col))

    return {
        "slide_data": {
            "District": district_name,
            "Campus":   district_name,   # CCMR template title uses {{Campus}}
        },
        "chart_data": {
            "categories": ["TSI", "IBC", "Enrollment"],
            "series": [
                {"name": str(years[0]), "values": [tsi_v[0], ibc_v[0], enr_v[0]]},
                {"name": str(years[1]), "values": [tsi_v[1], ibc_v[1], enr_v[1]]},
                {"name": str(years[2]), "values": [tsi_v[2], ibc_v[2], enr_v[2]]},
            ],
            "mode": mode,
        },
    }
