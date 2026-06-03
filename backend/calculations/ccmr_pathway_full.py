"""CCMR Pathway Full — all qualifiers breakdown."""
import pandas as pd

REQUIRED_FIELDS = {
    "ccmr_pathway_full": [
        {"key":"year","label":"Year → filter to latest class",
         "description":"Graduation class year. Typical name: 'Class'",
         "candidates":["Class","Year","Graduation Year","Cohort","School Year"]},
        {"key":"tsi_elar","label":"TSI ELAR Status → pathway bar",
         "description":"Typical name: 'TSI ELAR Status'. Values: Met, Not Met",
         "candidates":["TSI ELAR Status","TSI ELAR","ELAR Status"],"optional":True},
        {"key":"tsi_math","label":"TSI Math Status → pathway bar",
         "description":"Typical name: 'TSI Math Status'. Values: Met, Not Met",
         "candidates":["TSI Math Status","TSI Math","Math Status"],"optional":True},
        {"key":"ibc","label":"IBC / Certification → pathway bar",
         "description":"Typical name: 'CCMR Certification Status'. Values: Met, Not Met",
         "candidates":["CCMR Certification Status","IBC","IBC Status","IBC Met"],"optional":True},
        {"key":"cp_english","label":"College Prep English → pathway bar",
         "description":"Typical name: 'Passed College Prep English'. Values: Yes, No",
         "candidates":["Passed College Prep English","College Prep English","CP English"],"optional":True},
        {"key":"cp_math","label":"College Prep Math → pathway bar",
         "description":"Typical name: 'Passed College Prep Math'. Values: Yes, No",
         "candidates":["Passed College Prep Math","College Prep Math","CP Math"],"optional":True},
        {"key":"dual_credit","label":"Dual Credit → pathway bar",
         "description":"Typical name: 'CCMR Dual Credit Status'. Values: Met, Not Met",
         "candidates":["CCMR Dual Credit Status","Dual Credit Status","Dual Credit"],"optional":True},
        {"key":"ap_ib","label":"AP / IB → pathway bar",
         "description":"Typical name: 'CCMR AP/IB Status'. Values: Met, Not Met",
         "candidates":["CCMR AP/IB Status","AP/IB Status","AP IB"],"optional":True},
        {"key":"onramps","label":"OnRamps → pathway bar",
         "description":"Typical name: 'CCMR OnRamps Status'. Values: Met, Not Met",
         "candidates":["CCMR OnRamps Status","OnRamps Status","OnRamps"],"optional":True},
        {"key":"assoc_degree","label":"Associate Degree → pathway bar",
         "description":"Typical name: 'CCMR Associate Degree Status'",
         "candidates":["CCMR Associate Degree Status","Associate Degree Status"],"optional":True},
        {"key":"sped_adv","label":"SpEd Advanced Diploma → pathway bar",
         "description":"Typical name: 'CCMR SpEd with Advanced Diploma Status'",
         "candidates":["CCMR SpEd with Advanced Diploma Status","SpEd Advanced Diploma"],"optional":True},
        {"key":"sped_wf","label":"SpEd Workforce Ready → pathway bar",
         "description":"Typical name: 'CCMR SpEd Workforce Ready Status'",
         "candidates":["CCMR SpEd Workforce Ready Status","SpEd Workforce Ready"],"optional":True},
        {"key":"military","label":"Military Service → pathway bar",
         "description":"Typical name: 'Military Service Confirmed'",
         "candidates":["Military Service Confirmed","Military Service","Military"],"optional":True},
    ]
}

_FC = lambda df, cands: next((c for c in (str(col).strip() for col in df.columns) if c.strip().lower() in {cn.strip().lower() for cn in cands}), None)


def _pct_met(series, met_vals=("met","yes","y","true","1","confirmed","intent")):
    if series is None: return 0.0
    total = len(series)
    if total == 0: return 0.0
    met = series.astype(str).str.strip().str.lower().isin(met_vals).sum()
    return round(float(met)/total*100, 1)


def calculate_ccmr_pathway_full(df: pd.DataFrame, overrides: dict = None,
                                 mode: str = "percent", aggregation_level: str = "district") -> dict:
    overrides = overrides or {}
    dist_col = _FC(df, ["_district_display_name","_district_name"])
    district = str(df[dist_col].dropna().iloc[0]) if dist_col and len(df[dist_col].dropna()) else "District"

    year_col = overrides.get("year") or _FC(df, ["Class","Year","Graduation Year","Cohort","School Year"])
    if year_col and year_col in df.columns:
        df = df.copy()
        df["_yr"] = pd.to_numeric(df[year_col], errors="coerce")
        latest = df["_yr"].max()
        df = df[df["_yr"] == latest]

    PATHWAY_MAP = [
        ("TSI ELAR",          overrides.get("tsi_elar")    or _FC(df, ["TSI ELAR Status","TSI ELAR","ELAR Status"])),
        ("TSI Math",          overrides.get("tsi_math")    or _FC(df, ["TSI Math Status","TSI Math","Math Status"])),
        ("IBC / Cert.",       overrides.get("ibc")         or _FC(df, ["CCMR Certification Status","IBC","IBC Status"])),
        ("College Prep Math", overrides.get("cp_math")     or _FC(df, ["Passed College Prep Math","College Prep Math"])),
        ("College Prep Eng.", overrides.get("cp_english")  or _FC(df, ["Passed College Prep English","College Prep English"])),
        ("Dual Credit",       overrides.get("dual_credit") or _FC(df, ["CCMR Dual Credit Status","Dual Credit Status"])),
        ("Certification",     overrides.get("ibc")         or _FC(df, ["CCMR Certification Status","IBC"])),
        ("AP / IB",           overrides.get("ap_ib")       or _FC(df, ["CCMR AP/IB Status","AP/IB Status"])),
        ("OnRamps",           overrides.get("onramps")     or _FC(df, ["CCMR OnRamps Status","OnRamps Status"])),
        ("Associate Degree",  overrides.get("assoc_degree")or _FC(df, ["CCMR Associate Degree Status"])),
        ("SpEd Adv. Diploma", overrides.get("sped_adv")    or _FC(df, ["CCMR SpEd with Advanced Diploma Status"])),
        ("SpEd Workforce",    overrides.get("sped_wf")     or _FC(df, ["CCMR SpEd Workforce Ready Status"])),
        ("Military",          overrides.get("military")    or _FC(df, ["Military Service Confirmed","Military Service"])),
    ]

    # Deduplicate (IBC appears twice from different columns)
    seen = set()
    results = []
    for label, col in PATHWAY_MAP:
        if col and col not in seen and col in df.columns:
            pct = _pct_met(df[col])
            if pct > 0 or True:  # include even 0%
                results.append((label, pct))
                seen.add(col)

    if not results:
        results = [("No pathway data found", 0.0)]

    # Sort descending
    results.sort(key=lambda x: x[1], reverse=True)
    cats   = [r[0] for r in results]
    values = [r[1] for r in results]

    return {
        "slide_data": {"District": district, "Campus": district, "Title": "CCMR Pathway Analysis"},
        "chart_data": {"categories": cats,
                       "series": [{"name": "% of Students Who Qualified", "values": values}],
                       "mode": "percent"},
    }
