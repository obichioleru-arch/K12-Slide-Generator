"""
District Profile — 6 metrics over 3 years as mini grouped bar charts.
Metrics: A-F CCMR, TSI by Assessment, IBC, Financial Aid, College Enrollment, Associate Degree
"""
import pandas as pd

REQUIRED_FIELDS = {
    "district_profile": [
        {"key":"year","label":"Year Column",
         "description":"Graduation class year. Typical name: 'Class'",
         "candidates":["Class","Year","Graduation Year","Cohort","School Year"]},
        {"key":"tsi","label":"TSI Status → TSI Met by Assessment rate",
         "description":"Typical name: 'TSI Status'. Values: Met, Approaches, Not Met",
         "candidates":["TSI Status","TSI Met","TSI","TSI (Assessment Only) Status"]},
        {"key":"ccmr_overall","label":"CCMR Overall → A-F CCMR Met Rate",
         "description":"Typical name: 'CCMR Overall Status'. Values: Met, Not Met",
         "candidates":["CCMR Overall Status","Overall CCMR Status","CCMR Status"]},
        {"key":"ibc","label":"IBC / Certification Status",
         "description":"Typical name: 'CCMR Certification Status'. Values: Met, Not Met",
         "candidates":["CCMR Certification Status","IBC Status","IBC","IBC Met"],
         "optional":True},
        {"key":"dual_credit","label":"Dual Credit → College Enrollment proxy",
         "description":"Typical name: 'CCMR Dual Credit Status'. Values: Met, Not Met",
         "candidates":["CCMR Dual Credit Status","Dual Credit Status"],
         "optional":True},
        {"key":"assoc_degree","label":"Associate Degree Status",
         "description":"Typical name: 'CCMR Associate Degree Status'",
         "candidates":["CCMR Associate Degree Status","Associate Degree Status"],
         "optional":True},
    ]
}

_FC = lambda df, cands: next((c for c in df.columns if str(c).strip().lower() in {cn.lower() for cn in cands}), None)

def _pct_met(series, met_vals=("met","yes","y","true","1")):
    if series is None: return 0.0
    t = len(series); m = series.astype(str).str.strip().str.lower().isin(met_vals).sum()
    return round(float(m)/t*100, 1) if t else 0.0

def calculate_district_profile(df: pd.DataFrame, overrides: dict = None,
                                mode: str = "percent", aggregation_level: str = "district") -> dict:
    overrides = overrides or {}
    dist_col = _FC(df, ["_district_display_name","_district_name"])
    district = str(df[dist_col].dropna().iloc[0]) if dist_col and len(df[dist_col].dropna()) else "District"

    year_col      = overrides.get("year")         or _FC(df, ["Class","Year","Graduation Year","Cohort"])
    tsi_col       = overrides.get("tsi")          or _FC(df, ["TSI Status","TSI Met","TSI","TSI (Assessment Only) Status"])
    ccmr_col      = overrides.get("ccmr_overall") or _FC(df, ["CCMR Overall Status","Overall CCMR Status"])
    ibc_col       = overrides.get("ibc")          or _FC(df, ["CCMR Certification Status","IBC Status","IBC"])
    dual_col      = overrides.get("dual_credit")  or _FC(df, ["CCMR Dual Credit Status","Dual Credit Status"])
    assoc_col     = overrides.get("assoc_degree") or _FC(df, ["CCMR Associate Degree Status"])

    if not year_col:
        raise ValueError("Year column is required for District Profile.")

    df = df.copy()
    df["_yr"] = pd.to_numeric(df[year_col], errors="coerce")
    years = sorted(y for y in df["_yr"].dropna().unique() if 2018 <= y <= 2030)
    if not years: raise ValueError("No valid years found.")

    # Use at most last 3 years
    years = years[-3:]

    def by_year(col):
        row = []
        for yr in years:
            ydf = df[df["_yr"] == yr]
            if col and col in df.columns:
                row.append(_pct_met(ydf[col]))
            else:
                row.append(0.0)
        return row

    cats  = [str(int(y)) for y in years]
    metrics = [
        {"name":"A-F CCMR Met Rate",        "values": by_year(ccmr_col)},
        {"name":"TSI by Assessment Rate",    "values": by_year(tsi_col)},
        {"name":"IBC Completion Rate",       "values": by_year(ibc_col)},
        {"name":"College Enrollment Rate",   "values": by_year(dual_col)},
        {"name":"Associate Degree",          "values": by_year(assoc_col)},
    ]

    return {
        "slide_data": {"District": district, "Campus": district, "Title": "EMC District Profile"},
        "chart_data": {"categories": cats, "series": metrics, "mode": "percent"},
    }
