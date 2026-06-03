"""
TSI Calculators.

aggregation_level:
  "district" — collapse all rows into one result per year / one bar per _district_name group
  "campus"   — group by campus/institution column, one bar per campus

_district_name column is only present when multiple districts are loaded (cross-district mode).
When present + aggregation_level="district": group by _district_name.
When present + aggregation_level="campus":  group by campus column (ignore _district_name).
"""
import pandas as pd

REQUIRED_FIELDS = {
    "tsi_status_trends": [
        {"key": "year",
         "label": "Year → X-axis chart labels",
         "description": "Graduation year column (chart categories). Typical name: 'Class'",
         "candidates": ["Class","Year","Graduation Year","Cohort","School Year"]},
        {"key": "tsi_status",
         "label": "TSI Status → 'TSI Met by Assessment' bar",
         "description": "TSI assessment result. Typical name: 'TSI Status'. Values: Met, Approaches, Not Met",
         "candidates": ["TSI Status","TSI Met","TSI","TSI (Assessment Only) Status","TSI Assessment Status"]},
        {"key": "ccmr_tsi",
         "label": "CCMR TSI Status → 'TSI Met by CP/Assessment' bar (optional)",
         "description": "Students who met TSI via College Prep course. Typical name: 'CCMR TSI Status'. Values: Met, Not Met",
         "candidates": ["CCMR TSI Status","CCMR TSI","TSI CP Status"],
         "optional": True},
    ],
    "tsi_status": [
        {"key": "year",
         "label": "Year → filters to most recent class",
         "description": "Graduation year column. Typical name: 'Class'",
         "candidates": ["Class","Year","Graduation Year","Cohort","School Year"]},
        {"key": "tsi_status",
         "label": "TSI Status → 'TSI Met by Assessment' bar",
         "description": "TSI assessment result. Typical name: 'TSI Status'. Values: Met, Approaches, Not Met",
         "candidates": ["TSI Status","TSI Met","TSI","TSI (Assessment Only) Status","TSI Assessment Status"]},
        {"key": "ccmr_tsi",
         "label": "CCMR TSI Status → 'TSI Met by CP/Assessment' bar (optional)",
         "description": "Students who met TSI via College Prep. Typical name: 'CCMR TSI Status'",
         "candidates": ["CCMR TSI Status","CCMR TSI","TSI CP Status"],
         "optional": True},
    ],
    "tsi_leaderboard": [
        {"key": "year",
         "label": "Year → filters to most recent class",
         "description": "Graduation year column. Typical name: 'Class'",
         "candidates": ["Class","Year","Graduation Year","Cohort","School Year"]},
        {"key": "tsi_status",
         "label": "TSI Status → bar length (% or # met by assessment)",
         "description": "TSI assessment result. Typical name: 'TSI Status'. Values: Met, Approaches, Not Met",
         "candidates": ["TSI Status","TSI Met","TSI","TSI (Assessment Only) Status","TSI Assessment Status"]},
    ],
}
CAMPUS_CANDIDATES = [
    "Primary Educational Institution","Campus","Campus Name",
    "School","School Name","High School",
]


def _find_column(df: pd.DataFrame, candidates: list) -> str | None:
    clean = {str(c).strip().lower(): c for c in df.columns}
    for cand in candidates:
        if cand.strip().lower() in clean:
            return clean[cand.strip().lower()]
    return None


def shorten_name(name: str) -> str:
    return (str(name)
        .replace("Career High School","Career HS")
        .replace("High School","HS")
        .replace("Accelerated","Accel."))


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


def _get_group_col(df, aggregation_level):
    """
    Determine the correct grouping column.
    - "district" + _district_name present → group by _district_name (cross-district)
    - "district" only → no grouping (aggregate all into one)
    - "campus" → always group by campus column (never by _district_name)
    """
    if aggregation_level == "campus":
        return _find_column(df, CAMPUS_CANDIDATES)
    elif aggregation_level == "district" and "_district_name" in df.columns:
        return "_district_name"
    return None  # single district aggregate


def _get_district_label(df, group_col):
    """Get a readable district label for slide_data."""
    # _district_display_name is always set when loading from a named sheet
    if "_district_display_name" in df.columns:
        vals = df["_district_display_name"].dropna().unique()
        if len(vals) == 1:
            return str(vals[0])
        elif len(vals) > 1:
            return ", ".join(sorted(str(v) for v in vals))
    if "_district_name" in df.columns:
        vals = df["_district_name"].dropna().unique()
        return ", ".join(sorted(str(v) for v in vals)) if len(vals) > 0 else "District"
    return "District"


def _tsi_metrics(ydf, tsi_col, ccmr_col, mode):
    total = len(ydf)
    if total == 0: return 0, 0, 0
    tc = ydf[tsi_col].astype(str).str.strip().str.lower()
    m = int((tc == "met").sum())
    n = int((tc == "not met").sum())
    c = int((ydf[ccmr_col].astype(str).str.strip().str.lower() == "met").sum()) if ccmr_col and ccmr_col in ydf.columns else 0
    if mode == "percent":
        return round(m/total*100,1), round(c/total*100,1), round(n/total*100,1)
    return m, c, n


# ── TSI Status Trends ─────────────────────────────────────────────────────────
def calculate_tsi_status_trends(df: pd.DataFrame, overrides: dict = None,
                                 mode: str = "count", aggregation_level: str = "district") -> dict:
    overrides = overrides or {}
    cols = _resolve(df, overrides, REQUIRED_FIELDS["tsi_status_trends"])
    year_col = cols["year"]
    tsi_col  = cols["tsi_status"]
    ccmr_col = cols.get("ccmr_tsi")

    district_name = _get_district_label(df, None)
    group_col = _get_group_col(df, aggregation_level)

    df = df.copy()
    df["_yr"] = pd.to_numeric(df[year_col], errors="coerce")
    df = df[df["_yr"].between(2018, 2030)]
    years = sorted(df["_yr"].dropna().unique())

    def _year_series():
        cats, assessment, cp, notmet = [], [], [], []
        for yr in years:
            ydf = df[df["_yr"] == yr]
            m, c, n = _tsi_metrics(ydf, tsi_col, ccmr_col, mode)
            # Skip years with no data at all
            if m + c + n == 0:
                continue
            cats.append(str(int(yr))); assessment.append(m); cp.append(c); notmet.append(n)
        return cats, assessment, cp, notmet

    if group_col and aggregation_level == "campus":
        # Campus trends: show latest year, one bar group per campus
        latest = df["_yr"].max()
        ydf = df[df["_yr"] == latest]
        groups = sorted(ydf[group_col].dropna().unique())
        cats, assessment, cp, notmet = [], [], [], []
        for group in groups:
            gdf = ydf[ydf[group_col] == group]
            m, c, n = _tsi_metrics(gdf, tsi_col, ccmr_col, mode)
            if m + c + n == 0: continue
            cats.append(shorten_name(group)); assessment.append(m); cp.append(c); notmet.append(n)
    elif group_col and aggregation_level == "district":
        cats, assessment, cp, notmet = _year_series()
    else:
        cats, assessment, cp, notmet = _year_series()

    return {
        "slide_data": {"District": district_name, "Campus": district_name},
        "chart_data": {"categories": cats, "series": [
            {"name": "TSI Met by Assessment",    "values": assessment},
            {"name": "TSI Met by CP/Assessment", "values": cp},
            {"name": "TSI Not Met",              "values": notmet},
        ], "mode": mode},
    }


# ── TSI Status ────────────────────────────────────────────────────────────────
def calculate_tsi_status(df: pd.DataFrame, overrides: dict = None,
                          mode: str = "count", aggregation_level: str = "campus") -> dict:
    overrides = overrides or {}
    cols = _resolve(df, overrides, REQUIRED_FIELDS["tsi_status"])
    year_col = cols["year"]
    tsi_col  = cols["tsi_status"]
    ccmr_col = cols.get("ccmr_tsi")

    group_col = _get_group_col(df, aggregation_level)
    district_name = _get_district_label(df, group_col)

    df = df.copy()
    df["_yr"] = pd.to_numeric(df[year_col], errors="coerce")
    latest = df["_yr"].max()
    ydf = df[df["_yr"] == latest].copy()

    if group_col and group_col in ydf.columns:
        groups = sorted(ydf[group_col].dropna().unique())
        cats, assessment, cp, notmet = [], [], [], []
        for group in groups:
            gdf = ydf[ydf[group_col] == group]
            m, c, n = _tsi_metrics(gdf, tsi_col, ccmr_col, mode)
            cats.append(shorten_name(group)); assessment.append(m); cp.append(c); notmet.append(n)
    else:
        m, c, n = _tsi_metrics(ydf, tsi_col, ccmr_col, mode)
        cats = [shorten_name(district_name)]; assessment = [m]; cp = [c]; notmet = [n]

    return {
        "slide_data": {"District": district_name, "Campus": district_name},
        "chart_data": {"categories": cats, "series": [
            {"name": "TSI Met by Assessment",    "values": assessment},
            {"name": "TSI Met by CP/Assessment", "values": cp},
            {"name": "TSI Not Met",              "values": notmet},
        ], "mode": mode},
    }


# ── TSI Leaderboard ───────────────────────────────────────────────────────────
def calculate_tsi_leaderboard(df: pd.DataFrame, overrides: dict = None,
                               mode: str = "percent", aggregation_level: str = "campus") -> dict:
    overrides = overrides or {}
    cols = _resolve(df, overrides, REQUIRED_FIELDS["tsi_leaderboard"])
    year_col = cols["year"]
    tsi_col  = cols["tsi_status"]

    group_col = _get_group_col(df, aggregation_level)
    district_name = _get_district_label(df, group_col)

    df = df.copy()
    df["_yr"] = pd.to_numeric(df[year_col], errors="coerce")
    latest = df["_yr"].max()
    ydf = df[df["_yr"] == latest].copy()
    ydf["_tsi"] = ydf[tsi_col].astype(str).str.strip().str.lower()

    if group_col and group_col in ydf.columns:
        agg = (ydf.groupby(group_col)
            .agg(met=("_tsi", lambda x: (x=="met").sum()), total=("_tsi","count"))
            .reset_index())
        agg = agg[agg["total"] > 0].copy()
        agg["rate"] = (agg["met"] / agg["total"] * 100).round(1)
        agg = agg.sort_values("rate", ascending=True)
        cats   = [shorten_name(r[group_col]) for _, r in agg.iterrows()]
        values = [float(r["rate"]) for _, r in agg.iterrows()]
        counts = [int(r["met"]) for _, r in agg.iterrows()]    # students who met TSI
        totals = [int(r["total"]) for _, r in agg.iterrows()]  # total students per campus
    else:
        total = len(ydf); met = int((ydf["_tsi"] == "met").sum())
        rate  = round(met/total*100, 1) if total > 0 else 0.0
        cats = [shorten_name(district_name)]; values = [rate]
        counts = [met]; totals = [total]

    return {
        "slide_data": {"District": district_name, "Campus": district_name,
                       "Title": "College Readiness: TSI Leaderboard"},
        "chart_data": {"categories": cats,
                       "series": [{"name": "TSI Assessment Rate (%)", "values": values}],
                       "counts": counts, "totals": totals,
                       "mode": "percent"},
    }
