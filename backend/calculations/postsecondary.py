"""
Postsecondary Enrollment Calculator — production-ready.

Data format: one row per school per enrollment level (cross-sectional).
  High School | TEA ID | 2024 College Enrollment Level | 2024 College Enrollment %

Enrollment levels: 4YR, 2YR, AA Not Enrolled, Not Enrolled
Percentages are 0-1 decimals (e.g., 0.352 = 35.2%)
"""
import pandas as pd

REQUIRED_FIELDS = {
    "postsecondary_enrollment": [
        {"key": "level",
         "label": "Enrollment Level",
         "description": "Type of postsecondary enrollment. Typical column name: '2024 College Enrollment Level'. Values: 4YR, 2YR, Not Enrolled, AA Not Enrolled",
         "candidates": ["2024 College Enrollment Level","College Enrollment Level",
                        "Postsecondary Enrollment Level","Postsecondary Outcome",
                        "Enrollment Type","College Enrollment","Enrollment Status","Enrollment Level"]},
        {"key": "percent",
         "label": "Enrollment %",
         "description": "Percentage enrolled at each level. Typical column name: '2024 College Enrollment %'. Can be 0–1 decimal (e.g. 0.35) or 0–100",
         "candidates": ["2024 College Enrollment %","College Enrollment %",
                        "Postsecondary Enrollment %","Enrollment %",
                        "College Enrollment Percent","Postsecondary Enrollment Percent",
                        "Enrollment Percent"]},
        {"key": "school",
         "label": "School Name",
         "description": "Column identifying each school or campus. Typical column name: 'High School'",
         "candidates": ["High School","School","School Name","Campus","Campus Name",
                        "Primary Educational Institution","District","District Name"],
         "optional": True},
    ],
}

LEVEL_MAP = {
    "4yr":           ["4yr","4-year","4 year","four year","four-year"],
    "2yr":           ["2yr","2-year","2 year","two year","two-year"],
    "not_enrolled":  ["not enrolled"],
    "aa_not_enrolled":["aa not enrolled","not verified","unverified","aa not verified"],
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


def _to_pct(value) -> float:
    if pd.isna(value): return 0.0
    if isinstance(value, str):
        value = value.strip().replace("%","")
        if value.lower() in ("n/a","na","","none","-"): return 0.0
    try:
        n = float(value)
        return round(n * 100, 1) if n <= 1.0 else round(n, 1)
    except Exception:
        return 0.0


def calculate_postsecondary_enrollment(df: pd.DataFrame, overrides: dict = None,
                                        mode: str = "percent", aggregation_level: str = "campus") -> dict:
    overrides = overrides or {}
    cols = _resolve(df, overrides, REQUIRED_FIELDS["postsecondary_enrollment"])
    level_col   = cols["level"]
    percent_col = cols["percent"]
    school_col  = cols.get("school")

    district_name = str(df[school_col].dropna().iloc[0]) if school_col else "District"

    df = df.copy()
    df["_level"] = df[level_col].astype(str).str.strip().str.lower()
    df["_pct"]   = df[percent_col].apply(_to_pct)

    schools = df[school_col].dropna().astype(str).unique().tolist() if school_col else ["All Schools"]
    if not school_col:
        df["_school"] = "All Schools"
        school_col = "_school"

    four_yr, two_yr, not_enrolled, aa_not_enrolled = [], [], [], []

    def get_level(sdf, key):
        m = sdf[sdf["_level"].isin(LEVEL_MAP[key])]
        return float(m["_pct"].iloc[0]) if not m.empty else 0.0

    # If explicit campus selection provided, use it
    if overrides.get("selected_campuses"):
        sel = overrides["selected_campuses"]
        schools = [s for s in schools if s in sel]

    # Limit to 20 schools max to keep chart readable
    MAX_SCHOOLS = 20
    if len(schools) > MAX_SCHOOLS:
        schools = list(schools)[:MAX_SCHOOLS]

    labels = []
    for school in schools:
        sdf = df[df[school_col] == school]
        # Abbreviate "High School" → "HS" etc. for chart labels
        short = (str(school)
            .replace("Career High School", "Career HS")
            .replace("High School", "HS")
            .replace("Independent School District", "ISD"))
        labels.append(short.strip())
        four_yr.append(get_level(sdf, "4yr"))
        two_yr.append(get_level(sdf, "2yr"))
        not_enrolled.append(get_level(sdf, "not_enrolled"))
        aa_not_enrolled.append(get_level(sdf, "aa_not_enrolled"))

    return {
        "slide_data": {"District": district_name, "Campus": district_name},
        "chart_data": {
            "categories": labels,
            "series": [
                {"name": "4-Year College",  "values": four_yr},
                {"name": "2-Year College",  "values": two_yr},
                {"name": "Not Enrolled",    "values": not_enrolled},
                {"name": "AA Not Enrolled", "values": aa_not_enrolled},
            ],
            "stacked": True, "mode": "percent",
        },
    }
