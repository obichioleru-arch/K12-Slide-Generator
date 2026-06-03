"""By the Numbers — 3 key metrics: Students Served, TSI Met, HB3 Projection."""
import pandas as pd

REQUIRED_FIELDS = {
    "by_the_numbers": [
        {"key":"year","label":"Class / Graduation Year",
         "description":"Graduation year column. Typical name: 'Class'",
         "candidates":["Class","Year","Graduation Year","Cohort","School Year"]},
        {"key":"tsi","label":"TSI Status → TSI Met count",
         "description":"Typical name: 'TSI Status'. Values: Met, Not Met",
         "candidates":["TSI Status","TSI Met","TSI","CCMR TSI Status","TSI (Assessment Only) Status"]},
        {"key":"ibc","label":"IBC / Certification → HB3 calc",
         "description":"Typical name: 'CCMR Certification Status'. Values: Met, Not Met",
         "candidates":["CCMR Certification Status","IBC","IBC Status","IBC Met"],"optional":True},
        {"key":"eco","label":"Economically Disadvantaged → HB3 tiers",
         "description":"Typical name: 'Economically Disadvantaged'. Values: Y/N",
         "candidates":["Economically Disadvantaged","eco","EcoDis","Eco Disadvantaged"],"optional":True},
        {"key":"sped","label":"Special Education → HB3 tiers",
         "description":"Typical name: 'Special Education'. Values: Y/N",
         "candidates":["Special Education","SpEd","sped","Special Ed"],"optional":True},
    ]
}

_FC = lambda df, cands: next((c for c in df.columns if str(c).strip().lower() in {cn.lower() for cn in cands}), None)
_YN = lambda v: str(v).strip().lower() in ("y","yes","met","true","1","confirmed","intent")

def calculate_by_the_numbers(df: pd.DataFrame, overrides: dict = None,
                              mode: str = "count", aggregation_level: str = "district") -> dict:
    overrides = overrides or {}
    dist_col = _FC(df, ["_district_display_name","_district_name"])
    district = str(df[dist_col].dropna().iloc[0]) if dist_col and len(df[dist_col].dropna()) else "District"

    year_col = overrides.get("year") or _FC(df, ["Class","Year","Graduation Year","Cohort"])
    tsi_col  = overrides.get("tsi")  or _FC(df, ["TSI Status","TSI Met","TSI","CCMR TSI Status"])
    ibc_col  = overrides.get("ibc")  or _FC(df, ["CCMR Certification Status","IBC","IBC Status"])
    eco_col  = overrides.get("eco")  or _FC(df, ["Economically Disadvantaged","eco","EcoDis"])
    sped_col = overrides.get("sped") or _FC(df, ["Special Education","SpEd","sped"])

    # Filter to latest year
    cohort_label = ""
    if year_col and year_col in df.columns:
        df = df.copy()
        df["_yr"] = pd.to_numeric(df[year_col], errors="coerce")
        latest = df["_yr"].max()
        df = df[df["_yr"] == latest].copy()
        cohort_label = f"Class of {int(latest)}"

    total = len(df)

    # TSI Met
    tsi_met = 0
    tsi_pct = 0.0
    if tsi_col and tsi_col in df.columns:
        tsi_met = int(df[tsi_col].apply(_YN).sum())
        tsi_pct = round(tsi_met / total * 100, 1) if total else 0

    # Eco/Sped breakdowns
    eco_count  = int(df[eco_col].apply(_YN).sum())  if eco_col and eco_col in df.columns else 0
    sped_count = int(df[sped_col].apply(_YN).sum()) if sped_col and sped_col in df.columns else 0
    non_eco    = total - eco_count - sped_count

    # HB3 estimate
    if tsi_col and ibc_col and ibc_col in df.columns:
        df["_tsi"] = df[tsi_col].apply(_YN)
        df["_ibc"] = df[ibc_col].apply(_YN)
        df["_ob"]  = df["_tsi"] & df["_ibc"]
        df["_eco"] = df[eco_col].apply(_YN) if eco_col and eco_col in df.columns else False
        df["_sped"]= df[sped_col].apply(_YN) if sped_col and sped_col in df.columns else False

        thresh_eco  = max(0, int(eco_count * 0.11))
        thresh_non  = max(0, int(non_eco   * 0.24))
        eco_above   = max(0, int((df["_ob"] & df["_eco"]).sum())  - thresh_eco)
        non_above   = max(0, int((df["_ob"] & ~df["_eco"] & ~df["_sped"]).sum()) - thresh_non)
        sped_above  = int((df["_ob"] & df["_sped"]).sum())
        hb3_est     = eco_above * 5000 + non_above * 3000 + sped_above * 4000
    else:
        # Rough estimate using TSI only
        thresh  = max(0, int(total * 0.18))
        hb3_est = max(0, tsi_met - thresh) * 4000

    # Subtexts for circles
    eco_sub  = f"Eco Dis – {eco_count}<br>Non Eco Dis – {non_eco}<br>Special Need – {sped_count}" if eco_count or sped_count else ""
    tsi_sub  = f"{tsi_pct}% of students in {cohort_label}<br>have met TSI success metrics" if tsi_pct else ""
    hb3_sub  = f"HB3 Outcomes Bonus estimate<br>for {cohort_label}" if cohort_label else "HB3 Outcomes Bonus estimate"

    return {
        "slide_data": {
            "District":     district,
            "Cohort":       cohort_label,
            "Campus":       district,
            "Title":        "By The Numbers",
        },
        "chart_data": {
            "categories": ["High School Seniors Served", "TSI by Assessment", "HB3 Potential Projections"],
            "series":     [{"name":"Values","values":[total, tsi_met, hb3_est]}],
            "subtexts":   [eco_sub, tsi_sub, hb3_sub],
            "mode":       "count",
        },
    }
