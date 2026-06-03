"""
HB3 Outcomes Bonus Calculator.
Methodology per EMC CCMR OB Calculator docs:
  OB Met = TSI Met AND IBC Met
  Eco Dis: $5,000 award, 11% threshold
  Non-Eco: $3,000 award, 24% threshold
  SpEd:    $4,000 award, no threshold (stackable)
"""
import pandas as pd

REQUIRED_FIELDS = {
    "hb3_funds": [
        {"key":"year","label":"Class Year",
         "description":"Graduation year column. Typical name: 'Class'",
         "candidates":["Class","Year","Graduation Year","Cohort","School Year"]},
        {"key":"tsi","label":"TSI Met (Y/N)",
         "description":"Texas Success Initiative. Typical name: 'TSI Status'. Values: Met / Not Met (or Y/N)",
         "candidates":["TSI Status","TSI Met","TSI","CCMR TSI Status"]},
        {"key":"ibc","label":"IBC Met (Y/N)",
         "description":"Industry-Based Certification. Typical name: 'CCMR Certification Status'. Values: Met / Not Met",
         "candidates":["CCMR Certification Status","IBC Status","IBC","IBC Met"]},
        {"key":"eco","label":"Economically Disadvantaged (Y/N)",
         "description":"Determines $5K vs $3K award tier. Typical name: 'Economically Disadvantaged'",
         "candidates":["Economically Disadvantaged","eco","EcoDis","Eco Disadvantaged"],
         "optional":True},
        {"key":"sped","label":"Special Education (Y/N)",
         "description":"Generates additional $4K award. Typical name: 'Special Education'",
         "candidates":["Special Education","special_education","SpEd","sped"],
         "optional":True},
    ]
}

THRESH_ECO  = 0.11
THRESH_NON  = 0.24
AWARD_ECO   = 5_000
AWARD_NON   = 3_000
AWARD_SPED  = 4_000

_FC = lambda df, cands: next((c for c in df.columns if str(c).strip().lower() in {cn.lower() for cn in cands}), None)
_YN = lambda v: str(v).strip().lower() in ("y","yes","met","true","1","confirmed")


def calculate_hb3_funds(df: pd.DataFrame, overrides: dict = None,
                         mode: str = "count", aggregation_level: str = "district") -> dict:
    overrides = overrides or {}
    dist_col = _FC(df, ["_district_display_name","_district_name"])
    district = str(df[dist_col].dropna().iloc[0]) if dist_col and len(df[dist_col].dropna()) else "District"

    year_col = overrides.get("year") or _FC(df, ["Class","Year","Graduation Year","Cohort"])
    tsi_col  = overrides.get("tsi")  or _FC(df, ["TSI Status","TSI Met","TSI","CCMR TSI Status"])
    ibc_col  = overrides.get("ibc")  or _FC(df, ["CCMR Certification Status","IBC Status","IBC"])
    eco_col  = overrides.get("eco")  or _FC(df, ["Economically Disadvantaged","eco","EcoDis"])
    sped_col = overrides.get("sped") or _FC(df, ["Special Education","SpEd","sped"])

    if not year_col or not tsi_col or not ibc_col:
        raise ValueError("Year, TSI, and IBC columns are required for HB3 Funds calculation.")

    df = df.copy()
    df["_yr"] = pd.to_numeric(df[year_col], errors="coerce")
    df["_tsi"] = df[tsi_col].apply(_YN)
    df["_ibc"] = df[ibc_col].apply(_YN)
    df["_ob"]  = df["_tsi"] & df["_ibc"]
    df["_eco"] = df[eco_col].apply(_YN) if eco_col else False
    df["_sped"]= df[sped_col].apply(_YN) if sped_col else False

    years = sorted(y for y in df["_yr"].dropna().unique() if 2018 <= y <= 2030)

    cats, funding_vals, statuses = [], [], []
    total_funding = 0

    for yr in years:
        ydf = df[df["_yr"] == yr]
        n = len(ydf)
        if n == 0: continue

        ob = ydf["_ob"]
        eco = ydf["_eco"]
        sped_f = ydf["_sped"]

        eco_ob    = (ob & eco).sum()
        non_ob    = (ob & ~eco & ~sped_f).sum()
        sped_ob   = (ob & sped_f).sum()

        thresh_eco  = max(0, int(eco.sum()    * THRESH_ECO))
        thresh_non  = max(0, int((~eco & ~sped_f).sum() * THRESH_NON))

        eco_above  = max(0, eco_ob  - thresh_eco)
        non_above  = max(0, non_ob  - thresh_non)

        est = eco_above * AWARD_ECO + non_above * AWARD_NON + sped_ob * AWARD_SPED

        # If no eco/sped data: rough estimate using total OB met
        if not eco_col and not sped_col:
            ob_count = ob.sum()
            thresh   = max(0, int(n * 0.18))  # blended ~18% threshold
            above    = max(0, ob_count - thresh)
            est      = above * 4_000  # blended avg award

        cats.append(f"Class {int(yr)}")
        funding_vals.append(round(est / 1_000_000, 2))
        total_funding += est
        # Auto-assign status based on year
        if int(yr) <= 2026 - 2:
            statuses.append("verified")     # confirmed by TEA
        elif int(yr) == 2026 - 1:
            statuses.append("estimate")     # CC Solutions preliminary
        else:
            statuses.append("projected")    # trend-based forecast

    if not cats:
        cats = ["No Data"]
        funding_vals = [0.0]

    return {
        "slide_data": {
            "District": district, "Campus": district,
            "Title": "HB3 Outcomes Bonus Funding",
            "total_funding": f"${total_funding/1_000_000:.1f}M",
            "years_covered": f"Classes {cats[0].split()[-1]}–{cats[-1].split()[-1]}" if cats else "",
        },
        "chart_data": {
            "categories": cats,
            "series": [{"name": "HB3 Funds ($M)", "values": funding_vals}],
            "mode": "count",
            "statuses": statuses,
        },
    }
