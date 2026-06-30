"""District Slide Tool — Backend v10"""

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

import pandas as pd, shutil, os, json, traceback, re
try:
    import anthropic as _anthropic
    _ANTHROPIC_OK = True
except ImportError:
    _ANTHROPIC_OK = False
from datetime import datetime

from calculations.tsi import (
    calculate_tsi_status_trends, calculate_tsi_status, calculate_tsi_leaderboard,
    REQUIRED_FIELDS as TSI_FIELDS,
)
from calculations.ccmr import (
    calculate_ccmr_yoy_breakdown, REQUIRED_FIELDS as CCMR_FIELDS,
)
from calculations.postsecondary import (
    calculate_postsecondary_enrollment, REQUIRED_FIELDS as POST_FIELDS,
)
from slide_html import generate_html, generate_presentation_html
from pptx_exporter import generate_pptx_file
from calculations.ccmr_pathway_full import (
    calculate_ccmr_pathway_full, REQUIRED_FIELDS as PATHWAY_FULL_FIELDS,
)
from calculations.district_profile import (
    calculate_district_profile, REQUIRED_FIELDS as PROFILE_FIELDS,
)
from calculations.hb3 import (
    calculate_hb3_funds, REQUIRED_FIELDS as HB3_FIELDS,
)
from insights import compute_insights

app = FastAPI(title="District Slide Tool", version="10.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Update this after deploy: replace * with your Vercel URL
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
os.makedirs("uploads", exist_ok=True)
os.makedirs("outputs", exist_ok=True)

CATEGORY_MENU = {
    "Cover & Section": [
        {"slide_name": "Cover Slide",    "slide_type": "cover"},
        {"slide_name": "EMC Mission",    "slide_type": "mission"},
    ],
    "TSI": [
        {"slide_name": "TSI Status Trends",  "slide_type": "tsi_status_trends"},
        {"slide_name": "TSI Status",          "slide_type": "tsi_status"},
        {"slide_name": "TSI Leaderboard",     "slide_type": "tsi_leaderboard"},
    ],
    "CCMR": [
        {"slide_name": "CCMR YOY Breakdown",      "slide_type": "ccmr_yoy_breakdown"},
        {"slide_name": "CCMR A-F Status",          "slide_type": "ccmr_af_status"},
        {"slide_name": "CCMR Pathway (summary)",   "slide_type": "ccmr_pathway"},
        {"slide_name": "CCMR All Qualifiers",      "slide_type": "ccmr_pathway_full"},
    ],
    "District Profile": [
        {"slide_name": "District Profile",         "slide_type": "district_profile"},
    ],
    "Postsecondary": [
        {"slide_name": "Postsecondary Enrollment", "slide_type": "postsecondary_enrollment"},
    ],
    "HB3 Funding": [
        {"slide_name": "HB3 Outcomes Bonus Funding", "slide_type": "hb3_funds"},
    ],
    "Closing": [
        {"slide_name": "Outro / Thank You", "slide_type": "outro"},
    ],
    "Ad Hoc": [],
}

ALL_REQUIRED_FIELDS = {**TSI_FIELDS, **CCMR_FIELDS, **POST_FIELDS}

# Extra fields for new slide types
ALL_REQUIRED_FIELDS["cover"]            = []
ALL_REQUIRED_FIELDS["mission"]         = []
ALL_REQUIRED_FIELDS["methodology"]     = []
ALL_REQUIRED_FIELDS["section_divider"] = []
ALL_REQUIRED_FIELDS["agenda"]          = []
ALL_REQUIRED_FIELDS["outro"]           = []

ALL_REQUIRED_FIELDS["ccmr_yoy_breakdown"] = [
    {"key":"year","label":"Year",
     "description":"Year column used for the year-over-year comparison. Usually Class, School Year, Year, Graduation Year, or Cohort.",
     "candidates":["Class","School Year","Year","Graduation Year","Cohort"]},
    {"key":"tsi","label":"CCMR TSI Status",
     "description":"Source column for the TSI metric. Students marked Met are counted as TSI.",
     "candidates":["CCMR TSI Status","CCMR TSI","CCMR TSI Met","TSI Met","TSI Status","TSI","College Ready"]},
    {"key":"ibc","label":"IBC",
     "description":"Source column for Industry Based Certification.",
     "candidates":["Industry Based Certification","Industry-Based Certification","IBC","Certification/IBC","Certification","CCMR IBC Status"]},
    {"key":"enrollment","label":"College Enrollment",
     "description":"Source column for College Enrollment.",
     "candidates":["College Enrollment","Enrolled in College","Postsecondary Enrollment","Higher Education Enrollment","Enrollment","NSC Enrollment"]},
]

ALL_REQUIRED_FIELDS["ccmr_af_status"]  = CCMR_FIELDS.get("ccmr_yoy_breakdown", [])
ALL_REQUIRED_FIELDS.update(PATHWAY_FULL_FIELDS)
ALL_REQUIRED_FIELDS.update(PROFILE_FIELDS)

# District Profile uses a year/cohort plus optional profile metrics.
# Optional metrics render as Not Available instead of false 0% values.
DISTRICT_PROFILE_REQUIRED_FIELDS = [
    {"key":"year","label":"Year / Cohort","description":"Year or cohort used for the District Profile comparison.","candidates":["Class","School Year","Year","Graduation Year","Cohort"]},
    {"key":"ccmr","label":"CCMR A-F Status","description":"Optional profile metric. Students marked Met are counted in the CCMR A-F rate.","optional":True,"candidates":["CCMR Overall Status","CCMR Overall","CCMR A-F Status","CCMR A-F Overall","CCMR Status","CCMR"]},
    {"key":"tsi","label":"CCMR TSI / TSI","description":"Optional profile metric. Students marked Met are counted in the TSI rate.","optional":True,"candidates":["CCMR TSI Status","CCMR TSI","TSI Status","TSI","College Ready","TSI Met"]},
    {"key":"ibc","label":"IBC","description":"Optional profile metric. Students marked Met are counted in the IBC rate.","optional":True,"candidates":["CCMR Certification Status","CCMR IBC Status","IBC Status","IBC","Industry Based Certification","Industry-Based Certification","Certification/IBC","Certification"]},
    {"key":"financial_aid","label":"Financial Aid","description":"Optional profile metric. Students marked Met/Completed/Yes are counted in the Financial Aid rate.","optional":True,"candidates":["Financial Aid","Financial Aid Status","FAFSA","FAFSA Status","FAFSA Completion","TASFA","Financial Aid Application"]},
    {"key":"enrollment","label":"College Enrollment","description":"Optional profile metric. Students marked Met/Enrolled/Yes are counted in the College Enrollment rate.","optional":True,"candidates":["College Enrollment","Enrolled in College","Postsecondary Enrollment","Higher Education Enrollment","Enrollment","NSC Enrollment"]},
    {"key":"associate_degree","label":"Associate Degree","description":"Optional profile metric. Students marked Met/Earned/Yes are counted in the Associate Degree rate.","optional":True,"candidates":["Associate Degree","Associate Degree Status","Degree","Credential","Postsecondary Credential"]},
]
ALL_REQUIRED_FIELDS["district_profile"] = DISTRICT_PROFILE_REQUIRED_FIELDS
ALL_REQUIRED_FIELDS.update(HB3_FIELDS)


# Redesigned Postsecondary Readiness dashboard fields
ALL_REQUIRED_FIELDS["postsecondary_enrollment"] = [
    {"key":"campus","label":"Campus","description":"Campus or school name used for campus comparison.","candidates":["Primary_Educational_Institution__r.Name","Primary Educational Institution","Campus","Campus Name","School","School Name","High School"]},
    {"key":"year","label":"Class / Cohort Year","description":"Cohort year used for current vs prior year trend notes.","candidates":["Class__c","Class","Year","Graduation Year","Cohort","School Year"]},
    {"key":"college_app","label":"College Application Submitted","description":"Whether the student submitted a college application.","candidates":["College_Application_Submitted__c","College Application Submitted","College App Submitted","Application Submitted","College Applications Submitted"]},
    {"key":"financial_aid","label":"Financial Aid Submitted","description":"Whether the student submitted financial aid documentation.","candidates":["Financial_Aid_Submitted__c","Financial Aid Submitted","Financial Aid Submission","Financial_Aid_Submission_Confirmed__c"]},
    {"key":"fafsa","label":"FAFSA Submitted","description":"Whether the student submitted FAFSA.","optional":True,"candidates":["FAFSA_Submitted__c","FAFSA Submitted","FAFSA"]},
    {"key":"four_year_acceptance","label":"4-Year Acceptance","description":"Whether the student has a 4-year college acceptance.","optional":True,"candidates":["x4_Year_Acceptance__c","4-Year Acceptance","4 Year Acceptance","Four Year Acceptance"]},
]



ALL_REQUIRED_FIELDS["tsi_leaderboard"] = [
    {"key":"campus","label":"Campus",
     "description":"Campus or school name used for the leaderboard labels.",
     "candidates":["Primary Educational Institution","Campus","Campus Name","School","School Name","High School"]},
    {"key":"tsi","label":"CCMR TSI Status",
     "description":"Column indicating whether a student met CCMR TSI readiness. Values should include Met and Not Met.",
     "candidates":["CCMR TSI Status","CCMR TSI","CCMR TSI Met","TSI Met","TSI Status","TSI","College Ready"]},
]

ALL_REQUIRED_FIELDS["tsi_status"] = [
    {"key":"campus","label":"Campus",
     "description":"Campus or school name used for the horizontal bar labels.",
     "candidates":["Primary Educational Institution","Campus","Campus Name","School","School Name","High School"]},
    {"key":"tsi_met","label":"CCMR TSI Status",
     "description":"Column indicating whether a student met CCMR TSI readiness. Students marked Met are counted as TSI Met; all others are counted as TSI Not Met.",
     "candidates":["CCMR TSI Status","CCMR TSI","CCMR TSI Met","TSI Met","TSI Status","TSI","College Ready"]},
]

ALL_REQUIRED_FIELDS["tsi_status_trends"] = [
    {"key":"year","label":"Year",
     "description":"Year column used for the x-axis. Values can be 2022, 2023, 2024, 2025, 2026, or school-year labels.",
     "candidates":["School Year","Year","Class","Graduation Year","Cohort"]},
    {"key":"tsi_met","label":"CCMR TSI Status",
     "description":"Column indicating whether a student met CCMR TSI readiness. Students not marked as Met are counted as TSI Not Met.",
     "candidates":["CCMR TSI Status","CCMR TSI","TSI Met","TSI Met","TSI Met by Assessment","TSI Status Met","TSI Status","TSI","College Ready"]},
]

ALL_REQUIRED_FIELDS["ccmr_pathway"] = [
    {"key":"ccmr_status","label":"CCMR A-F / CCMR Status",
     "description":"Overall CCMR A-F status. Values should include Met, Approaches, and Not Met.",
     "candidates":["CCMR Overall Status","CCMR Overall","CCMR A-F Status","CCMR A-F Overall","CCMR Status","CCMR"]},
    {"key":"dual_credit","label":"Dual Credit",
     "description":"Dual Credit CCMR qualifier. Values should include Met and Not Met.",
     "candidates":["CCMR Dual Credit Status","Dual Credit Status","Dual Credit","CCMR Dual Credit","Dual Credit Met"]},
    {"key":"tsi","label":"CCMR TSI / TSI",
     "description":"CCMR TSI qualifier. Values should include Met, Approaches, and Not Met.",
     "candidates":["CCMR TSI Status","CCMR TSI","TSI Status","TSI","College Ready","TSI Met"]},
    {"key":"ap_ib","label":"AP/IB",
     "description":"AP/IB CCMR qualifier. Values should include Met and Not Met.",
     "candidates":["CCMR AP/IB Status","AP/IB Status","AP IB Status","AP/IB","AP Status","IB Status"]},
    {"key":"ibc","label":"IBC",
     "description":"Industry-Based Certification CCMR qualifier. Values should include Met and Not Met.",
     "candidates":["CCMR Certification Status","CCMR IBC Status","IBC Status","IBC","Industry Based Certification","Industry-Based Certification","Certification/IBC","Certification"]}
]



MANUAL_TEXT_FIELDS = [
    {"key":"District",    "label":"District / Organization Name",
     "description":"Name shown on the slide (e.g. 'Grand Prairie ISD')"},
    {"key":"month",       "label":"Month",
     "description":"Reporting month (e.g. 'May')"},
    {"key":"year_label",  "label":"Year",
     "description":"Reporting year (e.g. '2025')"},
    {"key":"data_source", "label":"Source",
     "description":"Data source shown in footer (e.g. 'TEA CC Solutions')"},
    {"key":"as_of_date",  "label":"As of Date",
     "description":"Data freshness date (e.g. 'May 15, 2026') — appears as 'Source: X as of Y'"},
    {"key":"footnote",    "label":"Additional Notes",
     "description":"Any extra footnote text appended after source/date"},
    {"key":"meeting_type","label":"Meeting Type (Cover only)",
     "description":"e.g. 'End of Year Partner Meeting'"},
    {"key":"subtitle",    "label":"Subtitle (Cover only)",
     "description":"Optional subtitle/tagline"},
]

CAMPUS_CANDIDATES = ["Primary Educational Institution","Campus","Campus Name","School","School Name","High School"]


def _clean_source_footnote(text: str) -> str:
    s = str(text or "").strip()
    s = re.sub(r"^(Source:\s*[^.]+\.?\s*)+(?=Source:\s*)", "", s, flags=re.I)
    s = re.sub(r"^Source:\s*District Salesforce\.\s*(?=Source:\s*)", "", s, flags=re.I)
    return s.strip()


def _campus_label(name: str) -> str:
    s = str(name or "").strip()
    replacements = [
        ("High School", "HS"),
        ("Accelerated", "Accel."),
        ("Academy", "Acad."),
        ("Collegiate Institute", "Collegiate Inst."),
        ("Career High", "Career"),
        ("Young Women's Leadership Academy", "YWLA"),
        ("at Bill Arnold", "Bill Arnold"),
    ]
    for old, new in replacements:
        s = s.replace(old, new)
    return s



# ── Local TSI Status Trends override ───────────────────────────────────────────
# This slide should show only TSI Met and TSI Not Met by year.
# College Prep is intentionally excluded from this slide.
def calculate_tsi_status_trends(df, overrides=None, mode="percent", aggregation_level="district"):
    """
    TSI Status Trends:
      - X-axis: Year / Class / School Year
      - Series: TSI Met and TSI Not Met
      - TSI Not Met is calculated as the complement of TSI Met:
          percent mode: 100 - TSI Met %
          count mode, row-level status/indicator: total rows - TSI Met count

    This intentionally removes the College Prep/Assessment series.
    """
    overrides = overrides or {}

    def _norm(v):
        return str(v).strip().lower()

    def _is_met(v):
        s = _norm(v)
        return s in {"met", "yes", "true", "1", "y", "passed", "pass"}

    def _is_not_met(v):
        s = _norm(v)
        return s in {"not met", "no", "false", "0", "n", "failed", "fail"}

    year_col = (
        overrides.get("year")
        or _fc(df, ["School Year", "Year", "Class", "Graduation Year", "Cohort"])
    )
    met_col = (
        overrides.get("tsi_met")
        or overrides.get("tsi")
        or _fc(df, [
            "CCMR TSI Status",
            "CCMR TSI",
            "TSI Met",
            "TSI Met",
            "TSI Met by Assessment",
            "TSI Status Met",
            "TSI Status",
            "TSI",
            "College Ready",
        ])
    )
    notmet_col = (
        overrides.get("tsi_not_met")
        or _fc(df, ["TSI Not Met", "TSI Status Not Met", "Not Met"])
    )

    if not year_col:
        raise ValueError("Could not find a Year column. Expected one of: School Year, Year, Class, Graduation Year, Cohort.")
    if not met_col:
        raise ValueError("Could not find a TSI Met column. Expected one of: CCMR TSI Status, CCMR TSI, TSI Met, TSI Met, TSI Met by Assessment, TSI Status, TSI, College Ready.")

    dist_col = _fc(df, ["_district_display_name", "_district_name", "District", "District Name", "LEA", "Organization"])
    district_name = "District"
    if dist_col and len(df[dist_col].dropna()):
        district_name = str(df[dist_col].dropna().iloc[0])

    work = df.copy()
    raw_year = work[year_col]

    # Keep school-year strings if they exist; otherwise use integer years.
    if raw_year.astype(str).str.contains("-", regex=False).any():
        work["_tsi_trend_year"] = raw_year.astype(str).str.strip()
    else:
        year_num = pd.to_numeric(raw_year, errors="coerce")
        work = work.loc[year_num.notna()].copy()
        work["_tsi_trend_year"] = year_num.loc[year_num.notna()].astype(int).astype(str)

    if work.empty:
        raise ValueError("No valid year values were found for TSI Status Trends.")

    categories = sorted(work["_tsi_trend_year"].dropna().astype(str).unique().tolist())

    met_values = []
    notmet_values = []

    for yr in categories:
        g = work[work["_tsi_trend_year"].astype(str) == str(yr)]
        met_series = g[met_col]

        # Numeric handling:
        # - Percent mode with one or more aggregate rows: average the percent and complement to 100.
        # - Count mode or 0/1 row-level indicators: sum met and use total - met.
        met_numeric = pd.to_numeric(met_series, errors="coerce")
        numeric_ratio = float(met_numeric.notna().mean()) if len(met_numeric) else 0.0

        if numeric_ratio >= 0.75:
            valid = met_numeric.dropna()

            if mode == "percent":
                if len(valid) == 0:
                    met_pct = 0.0
                elif float(valid.max()) <= 1.0:
                    met_pct = float(valid.mean()) * 100.0
                else:
                    met_pct = float(valid.mean())
                met_pct = max(0.0, min(100.0, met_pct))
                not_pct = 100.0 - met_pct
                met_values.append(round(met_pct, 1))
                notmet_values.append(round(not_pct, 1))
            else:
                # Row-level 0/1 indicators become counts. If an aggregate count is uploaded
                # without a denominator, prefer an explicit Not Met column when available.
                if len(valid) == len(g) and float(valid.max()) <= 1.0:
                    met_count = int(round(float(valid.sum())))
                    total = len(g)
                    not_count = max(0, total - met_count)
                elif notmet_col and notmet_col in g.columns:
                    met_count = int(round(float(valid.sum())))
                    not_count = int(round(float(pd.to_numeric(g[notmet_col], errors="coerce").fillna(0).sum())))
                else:
                    met_count = int(round(float(valid.sum())))
                    not_count = max(0, len(g) - met_count)
                met_values.append(met_count)
                notmet_values.append(not_count)
        else:
            # Status/text handling: Met count = rows marked met; Not Met = all remaining rows.
            flags = met_series.apply(_is_met)
            met_count = int(flags.sum())
            total = int(len(g))
            not_count = max(0, total - met_count)

            if mode == "percent":
                met_pct = (met_count / total * 100.0) if total else 0.0
                met_values.append(round(met_pct, 1))
                notmet_values.append(round(100.0 - met_pct, 1))
            else:
                met_values.append(met_count)
                notmet_values.append(not_count)

    return {
        "slide_data": {
            "District": district_name,
            "Campus": district_name,
            "Title": "TSI Status Trends",
        },
        "chart_data": {
            "categories": categories,
            "series": [
                {"name": "TSI Not Met", "values": notmet_values},
                {"name": "TSI Met", "values": met_values},
            ],
            "mode": mode,
        },
    }





# ── Local TSI Status by Campus override ────────────────────────────────────────
# Shows TSI Met vs. TSI Not Met by campus using CCMR TSI Status.
def calculate_tsi_status(df, overrides=None, mode="percent", aggregation_level="campus"):
    """
    TSI Status by Campus:
      - Y-axis: Campus
      - Series: TSI Not Met and TSI Met
      - TSI Met comes from CCMR TSI Status == Met.
      - TSI Not Met is everyone else, so percent mode totals 100%.
    """
    overrides = overrides or {}

    def _norm(v):
        return str(v).strip().lower()

    def _is_met(v):
        s = _norm(v)
        return s in {"met", "yes", "true", "1", "y", "passed", "pass"}

    campus_col = (
        overrides.get("campus")
        or _fc(df, ["Primary Educational Institution","Campus","Campus Name","School","School Name","High School"])
    )
    tsi_col = (
        overrides.get("tsi_met")
        or overrides.get("tsi")
        or _fc(df, ["CCMR TSI Status","CCMR TSI","CCMR TSI Met","TSI Met","TSI Status","TSI","College Ready"])
    )

    if not campus_col:
        raise ValueError("Could not find a Campus column. Expected one of: Primary Educational Institution, Campus, Campus Name, School, School Name, High School.")
    if not tsi_col:
        raise ValueError("Could not find a CCMR TSI Status column. Expected one of: CCMR TSI Status, CCMR TSI, TSI Met, TSI Met, TSI Status, TSI, College Ready.")

    dist_col = _fc(df, ["_district_display_name", "_district_name", "District", "District Name", "LEA", "Organization"])
    district_name = "District"
    if dist_col and len(df[dist_col].dropna()):
        district_name = str(df[dist_col].dropna().iloc[0])

    work = df[[campus_col, tsi_col]].copy()
    work = work[work[campus_col].notna()]
    work["_campus"] = work[campus_col].astype(str).str.strip()
    work = work[work["_campus"] != ""]
    if work.empty:
        raise ValueError("No valid campus values were found for TSI Status.")

    rows = []
    for campus, g in work.groupby("_campus", dropna=False):
        total = int(len(g))
        met_count = int(g[tsi_col].apply(_is_met).sum())
        notmet_count = max(0, total - met_count)
        if mode == "percent":
            met_value = round((met_count / total * 100.0), 1) if total else 0.0
            notmet_value = round(100.0 - met_value, 1)
        else:
            met_value = met_count
            notmet_value = notmet_count
        rows.append({"campus": str(campus), "met": met_value, "notmet": notmet_value, "total": total})

    rows.sort(key=lambda r: (r["met"], r["total"]), reverse=True)
    rows = rows[:12]

    return {
        "slide_data": {
            "District": district_name,
            "Campus": district_name,
            "Title": "TSI Status by Campus",
        },
        "chart_data": {
            "categories": [_campus_label(r["campus"]) for r in rows],
            "series": [
                {"name": "TSI Not Met", "values": [r["notmet"] for r in rows]},
                {"name": "TSI Met", "values": [r["met"] for r in rows]},
            ],
            "mode": mode,
        },
    }

# ── New calculators ───────────────────────────────────────────────────────────

def _calc_ccmr_af(df, overrides=None, mode="percent", aggregation_level="district"):
    """CCMR A-F Status: only requires CCMR Overall and derives Met / Approaches / Not Met."""
    from calculations.ccmr import _find_column
    overrides = overrides or {}

    overall_col = (
        overrides.get("ccmr_overall")
        or overrides.get("ccmr")
        or _find_column(df, ["CCMR Overall","CCMR Overall Status","CCMR A-F Overall","CCMR A-F Status","CCMR Status","CCMR"])
    )
    if not overall_col:
        raise ValueError("Could not find CCMR Overall column. Expected one of: CCMR Overall, CCMR Overall Status, CCMR A-F Overall, CCMR A-F Status, CCMR Status, CCMR.")

    dist_col = _find_column(df, ["_district_display_name","_district_name","District","District Name","LEA","Organization"] + CAMPUS_CANDIDATES)
    district_name = str(df[dist_col].dropna().iloc[0]) if dist_col and len(df[dist_col].dropna()) else "District"

    vals = df[overall_col].fillna("").astype(str).str.strip().str.lower().str.replace("_", " ", regex=False).str.replace("-", " ", regex=False)

    met = int((vals == "met").sum())
    approaches = int(vals.str.contains("approach", na=False).sum())
    notmet = int(vals.str.contains("not met", na=False).sum())

    # Anything blank/unknown is treated as Not Met so the denominator remains all selected students.
    total = int(len(vals))
    known = met + approaches + notmet
    if total > known:
        notmet += total - known

    safe_total = max(total, 1)
    met_pct = round(met / safe_total * 100.0, 1)
    approaches_pct = round(approaches / safe_total * 100.0, 1)
    notmet_pct = round(notmet / safe_total * 100.0, 1)

    goal_pct = 90.0
    target_count = int((goal_pct / 100.0 * safe_total) + 0.999999)
    additional_needed = max(0, target_count - met)
    gap_pts = round(max(0.0, goal_pct - met_pct), 1)

    return {
        "slide_data": {
            "District": district_name,
            "Campus": district_name,
            "Title": "CCMR A-F Accountability Status",
            "total_students": total,
            "goal_pct": goal_pct,
            "additional_needed": additional_needed,
            "gap_pts": gap_pts,
            "status_counts": {"Met": met, "Approaches": approaches, "Not Met": notmet},
            "status_percentages": {"Met": met_pct, "Approaches": approaches_pct, "Not Met": notmet_pct},
        },
        "chart_data": {
            "categories": ["Met", "Approaches", "Not Met"],
            "series": [{"name": "Students", "values": [met, approaches, notmet]}],
            "mode": "count",
            "goal_pct": goal_pct,
            "total_students": total,
            "additional_needed": additional_needed,
            "gap_pts": gap_pts,
            "status_percentages": [met_pct, approaches_pct, notmet_pct],
        },
    }






def _calc_ccmr_pathway(df, overrides=None, mode="count", aggregation_level="campus"):
    """CCMR Pathway Analysis dashboard.

    Restored behavior:
    - Aggregates all selected district/campus rows into one district-level result.
    - Shows the same dashboard structure as the HTML slide:
      Not on any pathway, Students on a CCMR Pathway, Dual Credit, TSI, AP/IB, IBC.
    - Required fields: CCMR A-F / CCMR Status, Dual Credit, CCMR TSI / TSI, AP/IB, IBC.
    """
    from calculations.ccmr import _find_column
    overrides = overrides or {}

    ccmr_col = (
        overrides.get("ccmr_status")
        or overrides.get("ccmr_overall")
        or _find_column(df, ["CCMR Overall Status","CCMR Overall","CCMR A-F Status","CCMR A-F Overall","CCMR Status","CCMR"])
    )
    dual_col = (
        overrides.get("dual_credit")
        or _find_column(df, ["CCMR Dual Credit Status","Dual Credit Status","Dual Credit","CCMR Dual Credit","Dual Credit Met"])
    )
    tsi_col = (
        overrides.get("tsi")
        or _find_column(df, ["CCMR TSI Status","CCMR TSI","TSI Status","TSI","College Ready","TSI Met"])
    )
    ap_col = (
        overrides.get("ap_ib")
        or overrides.get("apib")
        or _find_column(df, ["CCMR AP/IB Status","AP/IB Status","AP IB Status","AP/IB","AP Status","IB Status"])
    )
    ibc_col = (
        overrides.get("ibc")
        or _find_column(df, ["CCMR Certification Status","CCMR IBC Status","IBC Status","IBC","Industry Based Certification","Industry-Based Certification","Certification/IBC","Certification"])
    )

    missing = []
    for label, col in [
        ("CCMR A-F / CCMR Status", ccmr_col),
        ("Dual Credit", dual_col),
        ("CCMR TSI / TSI", tsi_col),
        ("AP/IB", ap_col),
        ("IBC", ibc_col),
    ]:
        if not col:
            missing.append(label)
    if missing:
        raise ValueError("Missing required CCMR Pathway field(s): " + ", ".join(missing))

    dist_col = _find_column(df, ["_district_display_name","_district_name","District","District Name","LEA","Organization"] + CAMPUS_CANDIDATES)
    district_name = str(df[dist_col].dropna().iloc[0]) if dist_col and len(df[dist_col].dropna()) else "District"

    def is_met_series(col):
        return df[col].fillna("").astype(str).str.strip().str.lower().eq("met")

    total = int(len(df))
    safe_total = max(total, 1)

    ccmr_met = is_met_series(ccmr_col)
    dual_met = is_met_series(dual_col)
    tsi_met = is_met_series(tsi_col)
    ap_met = is_met_series(ap_col)
    ibc_met = is_met_series(ibc_col)

    # "On pathway" is anyone Met on at least one listed pathway/qualifier.
    on_pathway_mask = ccmr_met | dual_met | tsi_met | ap_met | ibc_met
    on_pathway = int(on_pathway_mask.sum())
    not_on_pathway = int(total - on_pathway)

    dual_count = int(dual_met.sum())
    tsi_count = int(tsi_met.sum())
    ap_count = int(ap_met.sum())
    ibc_count = int(ibc_met.sum())

    def pct(v):
        return round((v / safe_total) * 100.0, 1)

    counts = {
        "Not on Any CCMR Pathway": not_on_pathway,
        "Students on a CCMR Pathway": on_pathway,
        "Dual Credit": dual_count,
        "TSI": tsi_count,
        "AP/IB": ap_count,
        "IBC": ibc_count,
    }
    percentages = {k: pct(v) for k, v in counts.items()}

    categories = ["Dual Credit", "TSI", "AP/IB", "IBC"]
    card_counts = [dual_count, tsi_count, ap_count, ibc_count]
    card_percentages = [pct(v) for v in card_counts]

    return {
        "slide_data": {
            "District": district_name,
            "Campus": district_name,
            "Title": "CCMR Pathway Analysis",
            "total_students": total,
            "on_pathway": on_pathway,
            "on_pathway_pct": pct(on_pathway),
            "not_on_pathway": not_on_pathway,
            "not_on_pathway_pct": pct(not_on_pathway),
            "counts": counts,
            "percentages": percentages,
        },
        "chart_data": {
            "categories": categories,
            "series": [{"name": "Students" if str(mode).lower() != "percent" else "Percent", "values": card_percentages if str(mode).lower() == "percent" else card_counts}],
            "counts": card_counts,
            "percentages": card_percentages,
            "mode": mode,
            "total_students": total,
            "on_pathway": on_pathway,
            "on_pathway_pct": pct(on_pathway),
            "not_on_pathway": not_on_pathway,
            "not_on_pathway_pct": pct(not_on_pathway),
        },
    }


def calculate_tsi_leaderboard(df, overrides=None, mode="percent", aggregation_level="campus"):
    """
    TSI Leaderboard:
      - Y-axis: Campus
      - Value: TSI Met rate or count
      - Source field: CCMR TSI Status
    """
    overrides = overrides or {}

    def _norm(v):
        return str(v).strip().lower()

    def _is_met(v):
        s = _norm(v)
        return s in {"met", "yes", "true", "1", "y", "passed", "pass"}

    campus_col = (
        overrides.get("campus")
        or _fc(df, ["Primary Educational Institution","Campus","Campus Name","School","School Name","High School"])
    )
    tsi_col = (
        overrides.get("tsi")
        or overrides.get("tsi_met")
        or _fc(df, ["CCMR TSI Status","CCMR TSI","CCMR TSI Met","TSI Met","TSI Status","TSI","College Ready"])
    )

    if not campus_col:
        raise ValueError("Could not find a Campus column. Expected one of: Primary Educational Institution, Campus, Campus Name, School, School Name, High School.")
    if not tsi_col:
        raise ValueError("Could not find a CCMR TSI Status column. Expected one of: CCMR TSI Status, CCMR TSI, TSI Met, TSI Met, TSI Status, TSI, College Ready.")

    dist_col = _fc(df, ["_district_display_name", "_district_name", "District", "District Name", "LEA", "Organization"])
    district_name = "District"
    if dist_col and len(df[dist_col].dropna()):
        district_name = str(df[dist_col].dropna().iloc[0])

    work = df[[campus_col, tsi_col]].copy()
    work = work[work[campus_col].notna()]
    work["_campus"] = work[campus_col].astype(str).str.strip()
    work = work[work["_campus"] != ""]
    if work.empty:
        raise ValueError("No valid campus values were found for TSI Leaderboard.")

    rows = []
    for campus, g in work.groupby("_campus", dropna=False):
        total = int(len(g))
        met_count = int(g[tsi_col].apply(_is_met).sum())
        if mode == "percent":
            value = round((met_count / total * 100.0), 1) if total else 0.0
        else:
            value = met_count
        rows.append({"campus": _campus_label(str(campus)) if "_campus_label" in globals() else str(campus), "value": value, "total": total})

    rows.sort(key=lambda r: (r["value"], r["total"]), reverse=True)
    rows = rows[:12]

    return {
        "slide_data": {
            "District": district_name,
            "Campus": district_name,
            "Title": "College Readiness: TSI Leaderboard",
        },
        "chart_data": {
            "categories": [r["campus"] for r in rows],
            "series": [{"name": "TSI Met", "values": [r["value"] for r in rows]}],
            "mode": mode,
        },
    }




# ── Local CCMR YOY Breakdown redesign override ────────────────────────────────
# Redesigned as three metric cards: TSI, IBC, and Enrollment by year.
def calculate_ccmr_yoy_breakdown(df, overrides=None, mode="percent", aggregation_level="district"):
    """
    CCMR YOY Breakdown:
      - Metrics: TSI, IBC, Enrollment
      - Years: Class / School Year / Year
      - User-facing labels stay business-friendly, while field mapping uses source fields.
    """
    overrides = overrides or {}

    def _norm(v):
        return str(v).strip().lower()

    def _is_met(v):
        s = _norm(v)
        return s in {"met", "yes", "true", "1", "y", "passed", "pass", "enrolled", "complete", "completed"}

    def _metric_value(group, col):
        if not col or col not in group.columns:
            return 0.0
        raw = group[col]
        numeric = pd.to_numeric(raw, errors="coerce")
        numeric_ratio = float(numeric.notna().mean()) if len(numeric) else 0.0

        if numeric_ratio >= 0.75:
            vals = numeric.dropna()
            if mode == "percent":
                if len(vals) == 0:
                    return 0.0
                if float(vals.max()) <= 1.0:
                    return round(float(vals.mean()) * 100.0, 1)
                if float(vals.max()) <= 100.0:
                    return round(float(vals.mean()), 1)
                return round(float(vals.sum()), 1)
            return int(round(float(vals.sum())))

        met_count = int(raw.apply(_is_met).sum())
        if mode == "percent":
            total = int(len(group))
            return round((met_count / total * 100.0), 1) if total else 0.0
        return met_count

    year_col = (
        overrides.get("year")
        or _fc(df, ["Class","School Year","Year","Graduation Year","Cohort"])
    )
    tsi_col = (
        overrides.get("tsi")
        or _fc(df, ["CCMR TSI Status","CCMR TSI","CCMR TSI Met","TSI Met","TSI Status","TSI","College Ready"])
    )
    ibc_col = (
        overrides.get("ibc")
        or _fc(df, ["Industry Based Certification","Industry-Based Certification","IBC","Certification/IBC","Certification","CCMR IBC Status"])
    )
    enrollment_col = (
        overrides.get("enrollment")
        or _fc(df, ["College Enrollment","Enrolled in College","Postsecondary Enrollment","Higher Education Enrollment","Enrollment","NSC Enrollment"])
    )

    if not year_col:
        raise ValueError("Could not find a Year column. Expected one of: Class, School Year, Year, Graduation Year, Cohort.")
    missing = []
    if not tsi_col: missing.append("CCMR TSI Status")
    if not ibc_col: missing.append("IBC")
    if not enrollment_col: missing.append("College Enrollment")
    if missing:
        raise ValueError("Could not find required CCMR YOY column(s): " + ", ".join(missing))

    dist_col = _fc(df, ["_district_display_name", "_district_name", "District", "District Name", "LEA", "Organization"])
    district_name = "District"
    if dist_col and len(df[dist_col].dropna()):
        district_name = str(df[dist_col].dropna().iloc[0])

    work = df.copy()
    raw_year = work[year_col]
    if raw_year.astype(str).str.contains("-", regex=False).any():
        work["_ccmr_year"] = raw_year.astype(str).str.strip()
    else:
        y = pd.to_numeric(raw_year, errors="coerce")
        work = work.loc[y.notna()].copy()
        work["_ccmr_year"] = y.loc[y.notna()].astype(int).astype(str)

    if work.empty:
        raise ValueError("No valid year values were found for CCMR YOY Breakdown.")

    years = sorted(work["_ccmr_year"].dropna().astype(str).unique().tolist())[-3:]

    metric_specs = [
        ("TSI", "CCMR TSI Status", tsi_col),
        ("IBC", "Industry Based Certification", ibc_col),
        ("Enrollment", "College Enrollment", enrollment_col),
    ]

    series = []
    for yr in years:
        g = work[work["_ccmr_year"].astype(str) == str(yr)]
        vals = [_metric_value(g, col) for _, _, col in metric_specs]
        series.append({"name": str(yr), "values": vals})

    return {
        "slide_data": {
            "District": district_name,
            "Campus": district_name,
            "Title": "CCMR YOY Breakdown",
            "metric_subtitles": {name: subtitle for name, subtitle, _ in metric_specs},
        },
        "chart_data": {
            "categories": [name for name, _, _ in metric_specs],
            "series": series,
            "mode": mode,
        },
    }





# ── Local CCMR A-F Accountability Status override ─────────────────────────────
def calculate_ccmr_af_status(df, overrides=None, mode="percent", aggregation_level="district"):
    overrides = overrides or {}

    def _norm(v):
        return str(v).strip().lower().replace("_", " ").replace("-", " ")

    overall_col = (
        overrides.get("ccmr_overall")
        or overrides.get("ccmr")
        or _fc(df, ["CCMR Overall","CCMR Overall Status","CCMR A-F Overall","CCMR A-F Status","CCMR Status","CCMR"])
    )

    if not overall_col:
        raise ValueError("Could not find a CCMR Overall column. Expected one of: CCMR Overall, CCMR Overall Status, CCMR A-F Overall, CCMR A-F Status, CCMR Status, CCMR.")

    dist_col = _fc(df, ["_district_display_name", "_district_name", "District", "District Name", "LEA", "Organization"])
    district_name = "District"
    if dist_col and len(df[dist_col].dropna()):
        district_name = str(df[dist_col].dropna().iloc[0])

    status = df[overall_col].fillna("").map(_norm)
    met_count = int(status.eq("met").sum())
    approaches_count = int(status.str.contains("approach", na=False).sum())
    not_met_count = int(status.str.contains("not met", na=False).sum())

    known = met_count + approaches_count + not_met_count
    total = int(len(status))
    if total > known:
        not_met_count += total - known

    safe_total = max(total, 1)
    met_pct = round((met_count / safe_total) * 100.0, 1)
    approaches_pct = round((approaches_count / safe_total) * 100.0, 1)
    not_met_pct = round((not_met_count / safe_total) * 100.0, 1)

    goal_pct = 90.0
    target_count = int((goal_pct / 100.0 * safe_total) + 0.999999)
    additional_needed = max(0, target_count - met_count)
    gap_pts = round(max(0.0, goal_pct - met_pct), 1)

    return {
        "slide_data": {
            "District": district_name,
            "Campus": district_name,
            "Title": "CCMR A-F Accountability Status",
            "total_students": total,
            "goal_pct": goal_pct,
            "additional_needed": additional_needed,
            "gap_pts": gap_pts,
            "status_counts": {
                "Met": met_count,
                "Approaches": approaches_count,
                "Not Met": not_met_count,
            },
            "status_percentages": {
                "Met": met_pct,
                "Approaches": approaches_pct,
                "Not Met": not_met_pct,
            },
        },
        "chart_data": {
            "categories": ["Met", "Approaches", "Not Met"],
            "series": [
                {"name": "Students", "values": [met_count, approaches_count, not_met_count]},
            ],
            "mode": "count",
            "goal_pct": goal_pct,
            "total_students": total,
            "additional_needed": additional_needed,
            "gap_pts": gap_pts,
            "status_percentages": [met_pct, approaches_pct, not_met_pct],
        },
    }




def calculate_district_profile(df, overrides=None, mode="percent", aggregation_level="district"):
    """District Profile: percent-met trend cards for profile metrics by year.

    Required: year/cohort. Metric columns are optional; missing metrics are
    returned as None so preview/HTML/PPTX can show Not Available rather than 0%.
    """
    overrides = overrides or {}

    def fc(candidates):
        clean = {str(c).strip().lower(): c for c in df.columns}
        for c in candidates:
            if str(c).strip().lower() in clean:
                return clean[str(c).strip().lower()]
        return None

    def is_positive(v):
        if pd.isna(v):
            return False
        s = str(v).strip().lower()
        if not s:
            return False
        positive = {"met","yes","y","true","1","passed","pass","complete","completed","enrolled","earned","received","submitted"}
        negative = {"not met","no","n","false","0","failed","fail","incomplete","not enrolled","did not enroll","none","missing","not submitted"}
        if s in positive:
            return True
        if s in negative:
            return False
        # Numeric 1/0 indicators and percentages are common in uploads.
        try:
            n = float(s.replace('%','').replace(',',''))
            return n > 0
        except Exception:
            return False

    def pct_for(g, col):
        if not col or col not in g.columns:
            return None
        valid = g[col].dropna()
        valid = valid[valid.astype(str).str.strip() != ""]
        if len(valid) == 0:
            return None
        numeric = pd.to_numeric(valid.astype(str).str.replace('%','', regex=False).str.replace(',','', regex=False), errors='coerce')
        # If the upload already contains aggregate percent values, average them.
        if numeric.notna().mean() >= 0.75 and len(valid) <= max(3, len(g) * 0.20) and numeric.max() > 1:
            return round(float(numeric.mean()), 1)
        return round(float(valid.apply(is_positive).sum()) / float(len(valid)) * 100.0, 1)

    year_col = overrides.get("year") or fc(["Class","School Year","Year","Graduation Year","Cohort"])
    if not year_col:
        raise ValueError("Could not find a Year/Cohort column. Expected one of: Class, School Year, Year, Graduation Year, Cohort.")

    dist_col = fc(["_district_display_name", "_district_name", "District", "District Name", "LEA", "Organization"])
    district_name = "District"
    if dist_col and len(df[dist_col].dropna()):
        district_name = str(df[dist_col].dropna().iloc[0])

    metric_defs = [
        ("CCMR A-F", overrides.get("ccmr") or fc(["CCMR Overall Status","CCMR Overall","CCMR A-F Status","CCMR A-F Overall","CCMR Status","CCMR"])),
        ("TSI", overrides.get("tsi") or fc(["CCMR TSI Status","CCMR TSI","TSI Status","TSI","College Ready","TSI Met"])),
        ("IBC", overrides.get("ibc") or fc(["CCMR Certification Status","CCMR IBC Status","IBC Status","IBC","Industry Based Certification","Industry-Based Certification","Certification/IBC","Certification"])),
        ("Financial Aid", overrides.get("financial_aid") or fc(["Financial Aid","Financial Aid Status","FAFSA","FAFSA Status","FAFSA Completion","TASFA","Financial Aid Application"])),
        ("College Enrollment", overrides.get("enrollment") or fc(["College Enrollment","Enrolled in College","Postsecondary Enrollment","Higher Education Enrollment","Enrollment","NSC Enrollment"])),
        ("Associate Degree", overrides.get("associate_degree") or fc(["Associate Degree","Associate Degree Status","Degree","Credential","Postsecondary Credential"])),
    ]

    work = df.copy()
    raw_year = work[year_col]
    if raw_year.astype(str).str.contains('-', regex=False).any():
        work['_profile_year'] = raw_year.astype(str).str.strip()
    else:
        year_num = pd.to_numeric(raw_year, errors='coerce')
        work = work.loc[year_num.notna()].copy()
        work['_profile_year'] = year_num.loc[year_num.notna()].astype(int).astype(str)
    if work.empty:
        raise ValueError("No valid year/cohort values were found for District Profile.")

    def sort_key(y):
        m = re.search(r"(20\d{2})", str(y))
        return int(m.group(1)) if m else str(y)
    categories = sorted(work['_profile_year'].dropna().astype(str).unique().tolist(), key=sort_key)

    series = []
    availability = {}
    for label, col in metric_defs:
        vals = []
        available = bool(col and col in work.columns and work[col].dropna().astype(str).str.strip().ne('').any())
        availability[label] = available
        for yr in categories:
            g = work[work['_profile_year'].astype(str) == str(yr)]
            vals.append(pct_for(g, col) if available else None)
        series.append({"name": label, "values": vals, "available": available, "column": col or ""})

    return {
        "slide_data": {
            "District": district_name,
            "Campus": district_name,
            "Title": "Economic Mobility Center District Profile",
            "total_students": int(len(work)),
            "cohorts": categories,
            "available_metrics": availability,
        },
        "chart_data": {
            "categories": categories,
            "series": series,
            "mode": "percent",
            "total_students": int(len(work)),
        },
    }

# ── Local Postsecondary Readiness dashboard override ──────────────────────────
def calculate_postsecondary_readiness(df, overrides=None, mode="percent", aggregation_level="campus"):
    """Executive dashboard for college application / FAFSA / acceptance progress."""
    overrides = overrides or {}
    def pick(key, candidates):
        return overrides.get(key) or _fc(df, candidates)
    def truthy(v):
        if pd.isna(v):
            return False
        s = str(v).strip().lower()
        if s in {"true", "yes", "y", "1", "met", "complete", "completed", "submitted", "confirmed", "accepted"}:
            return True
        if s in {"false", "no", "n", "0", "not met", "incomplete", "not submitted", "", "nan", "none", "null"}:
            return False
        try:
            return float(s.replace(",", "")) > 0
        except Exception:
            return False
    campus_col = pick("campus", ["Primary_Educational_Institution__r.Name","Primary Educational Institution","Campus","Campus Name","School","School Name","High School"])
    year_col = pick("year", ["Class__c","Class","Year","Graduation Year","Cohort","School Year"])
    district_col = _fc(df, ["_district_display_name", "_district_name", "District", "District Name", "LEA", "Organization"])
    metric_defs = [
        {"key":"college_app", "label":"College App Submitted", "col": pick("college_app", ["College_Application_Submitted__c","College Application Submitted","College App Submitted","Application Submitted","College Applications Submitted"]), "accent":"#0057B8"},
        {"key":"financial_aid", "label":"Financial Aid Submitted", "col": pick("financial_aid", ["Financial_Aid_Submitted__c","Financial Aid Submitted","Financial Aid Submission","Financial_Aid_Submission_Confirmed__c"]), "accent":"#00A7D8"},
        {"key":"fafsa", "label":"FAFSA Submitted", "col": pick("fafsa", ["FAFSA_Submitted__c","FAFSA Submitted","FAFSA"]), "accent":"#7C3AED"},
        {"key":"four_year_acceptance", "label":"4-Year Acceptance", "col": pick("four_year_acceptance", ["x4_Year_Acceptance__c","4-Year Acceptance","4 Year Acceptance","Four Year Acceptance"]), "accent":"#D99A00"},
    ]
    if not campus_col:
        raise ValueError("Could not find a Campus column. Expected Primary_Educational_Institution__r.Name, Primary Educational Institution, Campus, or School Name.")
    if not year_col:
        raise ValueError("Could not find a Class / Cohort Year column. Expected Class__c, Class, Year, Graduation Year, Cohort, or School Year.")
    if not any(m["col"] for m in metric_defs):
        raise ValueError("Could not find any postsecondary readiness metric columns such as College_Application_Submitted__c, Financial_Aid_Submitted__c, FAFSA_Submitted__c, or x4_Year_Acceptance__c.")
    work = df.copy()
    work = work[work[campus_col].notna()].copy()
    total = int(len(work))
    district_name = "District"
    if district_col and district_col in work.columns and len(work[district_col].dropna()):
        district_name = str(work[district_col].dropna().iloc[0])
    years_num = pd.to_numeric(work[year_col], errors="coerce") if year_col in work.columns else pd.Series([], dtype=float)
    valid_years = sorted(int(y) for y in years_num.dropna().unique() if 2018 <= int(y) <= 2035)
    current_year = valid_years[-1] if valid_years else None
    prior_year = valid_years[-2] if len(valid_years) >= 2 else None
    current_df = work.loc[years_num == current_year].copy() if current_year else work
    prior_df = work.loc[years_num == prior_year].copy() if prior_year else pd.DataFrame(columns=work.columns)
    current_total = int(len(current_df)) if len(current_df) else total
    def metric_count(frame, col):
        if not col or col not in frame.columns or frame.empty:
            return None
        return int(frame[col].apply(truthy).sum())
    kpis = []
    for m in metric_defs:
        col = m["col"]
        available = bool(col and col in work.columns and work[col].notna().any())
        count = metric_count(current_df, col) if available else None
        denom = current_total if current_total else 0
        pct = (count / denom * 100.0) if available and denom else None
        prev_count = metric_count(prior_df, col) if available and len(prior_df) else None
        prev_pct = (prev_count / len(prior_df) * 100.0) if prev_count is not None and len(prior_df) else None
        delta = (pct - prev_pct) if pct is not None and prev_pct is not None else None
        missing = (denom - count) if count is not None else None
        kpis.append({"key": m["key"], "label": m["label"], "column": col or "", "available": available, "count": count, "total": denom, "pct": round(pct, 1) if pct is not None else None, "missing_count": missing, "missing_pct": round((missing / denom * 100.0), 1) if missing is not None and denom else None, "delta_pp": round(delta, 1) if delta is not None else None, "accent": m["accent"]})
    # Default campus comparison should use a metric with meaningful campus spread.
    # FAFSA is retained as a KPI, but it is often too sparse for a useful ranking.
    # Prefer Financial Aid, then College App, then 4-Year Acceptance; only fall back
    # to FAFSA if those fields are unavailable.
    def campus_rows_for(metric_item):
        col = metric_item.get("column") if metric_item else None
        rows = []
        if not col or col not in current_df.columns:
            return rows
        for campus, g in current_df.groupby(campus_col, dropna=True):
            denom = int(len(g))
            count = int(g[col].apply(truthy).sum())
            pct = round(count / denom * 100.0, 1) if denom else 0.0
            rows.append({"campus": str(campus), "count": count, "total": denom, "pct": pct})
        return sorted(rows, key=lambda r: r["pct"], reverse=True)[:8]

    comparison = None
    comp_rows = []
    for key in ["financial_aid", "college_app", "four_year_acceptance", "fafsa"]:
        candidate = next((k for k in kpis if k["key"] == key and k["available"]), None)
        rows = campus_rows_for(candidate)
        if candidate and rows:
            comparison = candidate
            comp_rows = rows
            break
    if comparison is None:
        comparison = next((k for k in kpis if k["available"]), None)
        comp_rows = campus_rows_for(comparison)
    gaps = []
    # Opportunity gaps should emphasize the actionable readiness pipeline.
    # FAFSA remains a KPI when present, but the side panel defaults to broader
    # completion and acceptance gaps that are less likely to be all zero by campus.
    for k in ["college_app", "financial_aid", "four_year_acceptance"]:
        item = next((x for x in kpis if x["key"] == k), None)
        if item and item["available"]:
            label = item["label"].replace(" Submitted", "")
            gaps.append({"key": item["key"], "label": label, "missing_label": "Missing " + label, "missing_count": item["missing_count"], "missing_pct": item["missing_pct"], "total": item["total"], "accent": item["accent"]})
    return {"slide_data": {"District": district_name, "Campus": district_name, "Title": "Postsecondary Readiness", "total_students": current_total, "current_year": current_year, "prior_year": prior_year}, "chart_data": {"dashboard_type": "postsecondary_readiness", "mode": "percent", "total_students": current_total, "current_year": current_year, "prior_year": prior_year, "kpis": kpis, "comparison_metric": comparison["label"] if comparison else "Campus Comparison", "comparison": comp_rows, "opportunity_gaps": gaps, "categories": [r["campus"] for r in comp_rows], "series": [{"name": comparison["label"] if comparison else "Metric", "values": [r["pct"] for r in comp_rows]}] if comparison else []}}



def _normalize_hb3_payload(result: dict) -> dict:
    """Normalize HB3 status labels so outputs consistently show verified/estimated/projected.

    Business rule for HB3 slide:
      - 2025 should be Estimated
      - 2026 should be Projected
      - Earlier classes remain Verified unless calculator explicitly provides another status.
    """
    if not isinstance(result, dict):
        return result
    chart = result.get("chart_data") or {}
    cats = chart.get("categories") or []
    statuses = []
    for c in cats:
        txt = str(c or "")
        m = re.search(r"(20\d{2})", txt)
        yr = int(m.group(1)) if m else None
        if yr == 2025:
            statuses.append("estimate")
        elif yr == 2026:
            statuses.append("projected")
        else:
            statuses.append("verified")
    if statuses:
        chart["statuses"] = statuses
        chart["status_labels"] = ["ESTIMATED" if x == "estimate" else x.upper() for x in statuses]
        result["chart_data"] = chart
    return result

SLIDE_REGISTRY = {
    "cover":                   {"calculator": None,                        "layout": "cover",               "supports_modes":["percent"], "default_agg":"district", "needs_data": False},
    "tsi_status_trends":       {"calculator": calculate_tsi_status_trends, "layout":"tsi_stacked_column",   "supports_modes":["count","percent"], "default_agg":"district"},
    "tsi_status":              {"calculator": calculate_tsi_status,        "layout":"tsi_stacked_horizontal",   "supports_modes":["count","percent"], "default_agg":"campus"},
    "tsi_leaderboard":         {"calculator": calculate_tsi_leaderboard,   "layout":"tsi_leaderboard",      "supports_modes":["count","percent"], "default_agg":"campus"},
    "ccmr_yoy_breakdown":      {"calculator": calculate_ccmr_yoy_breakdown,"layout":"ccmr_yoy_cards",  "supports_modes":["count","percent"], "default_agg":"district"},
    "ccmr_af_status":          {"calculator": _calc_ccmr_af,               "layout":"ccmr_af_status",       "supports_modes":["count","percent"], "default_agg":"district"},
    "ccmr_pathway":            {"calculator": _calc_ccmr_pathway,          "layout":"ccmr_pathway",         "supports_modes":["count","percent"], "default_agg":"campus"},
    "postsecondary_enrollment":{"calculator": calculate_postsecondary_readiness,"layout":"postsecondary_readiness","supports_modes":["percent"],"default_agg":"campus"},
    "ccmr_pathway_full":       {"calculator": calculate_ccmr_pathway_full,      "layout":"ccmr_pathway_full",     "supports_modes":["percent"],         "default_agg":"district"},
    "district_profile":        {"calculator": calculate_district_profile,        "layout":"district_profile",       "supports_modes":["percent"],         "default_agg":"district"},
    "hb3_funds":               {"calculator": calculate_hb3_funds,               "layout":"hb3_funds",              "supports_modes":["count"],           "default_agg":"district"},
    "outro":                   {"calculator": None, "layout":"outro", "supports_modes":["percent"], "default_agg":"district", "needs_data": False},
    "mission":                 {"calculator": None,                               "layout":"mission",                "supports_modes":["percent"],         "default_agg":"district", "needs_data": False},
    "methodology":             {"calculator": None,                               "layout":"methodology",            "supports_modes":["percent"],         "default_agg":"district", "needs_data": False},
    "section_divider":         {"calculator": None,                               "layout":"section_divider",        "supports_modes":["percent"],         "default_agg":"district", "needs_data": False},
    "agenda":                  {"calculator": None,                               "layout":"agenda",                 "supports_modes":["percent"],         "default_agg":"district", "needs_data": False},
}

def _fc(df, candidates):
    clean = {str(c).strip().lower(): c for c in df.columns}
    for c in candidates:
        if c.strip().lower() in clean: return clean[c.strip().lower()]
    return None


# ── AI Insights ───────────────────────────────────────────────────────────────
# Try multiple model names in case one is unavailable
_PREFERRED_MODELS = [
    "claude-sonnet-4-6",
    "claude-sonnet-4-5-20251022",
    "claude-haiku-4-5-20251001",
]

def _generate_insights(slide_type: str, chart_data: dict, slide_data: dict, mode: str) -> list:

    if slide_type == "tsi_status_trends":
        try:
            categories = chart_payload.get("categories", [])
            series = chart_payload.get("series", [])
            by_name = {str(s.get("name","")).lower(): s.get("values", []) for s in series}
            met_vals = None
            not_vals = None
            for name, vals in by_name.items():
                if "not met" in name:
                    not_vals = vals
                elif "met" in name:
                    met_vals = vals

            if met_vals and not_vals and categories:
                met_nums = [float(x) for x in met_vals]
                not_nums = [float(x) for x in not_vals]
                first_year, last_year = str(categories[0]), str(categories[-1])
                first_met, last_met = met_nums[0], met_nums[-1]
                first_not, last_not = not_nums[0], not_nums[-1]
                met_change = last_met - first_met
                not_change = last_not - first_not

                if mode == "percent":
                    return [
                        f"TSI Met changed from {first_met:.1f}% in {first_year} to {last_met:.1f}% in {last_year} ({met_change:+.1f}pp).",
                        f"TSI Not Met changed from {first_not:.1f}% to {last_not:.1f}% over the same period ({not_change:+.1f}pp).",
                        "Prioritize campuses/cohorts with the largest TSI Not Met share and schedule targeted TSI prep, advising, and retesting support before the next reporting cycle."
                    ]
                else:
                    return [
                        f"TSI Met changed from {first_met:,.0f} students in {first_year} to {last_met:,.0f} students in {last_year} ({met_change:+,.0f}).",
                        f"TSI Not Met changed from {first_not:,.0f} to {last_not:,.0f} students over the same period ({not_change:+,.0f}).",
                        "Pull the student list behind the TSI Not Met segment and assign outreach owners for TSI prep, advising, and retesting follow-up before the next reporting cycle."
                    ]
        except Exception:
            pass
    """Generate AI insights using Claude API, fallback to rule-based if unavailable."""
    # Always compute rule-based insights first
    base_insights = compute_insights(slide_type, chart_data, slide_data, mode)

    if not _ANTHROPIC_OK:
        print("Insights: anthropic package not installed, using rule-based insights.")
        return base_insights

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("Insights: ANTHROPIC_API_KEY not set. Set it in PowerShell with:")
        print("  $env:ANTHROPIC_API_KEY = 'sk-ant-...'")
        print("Then restart uvicorn. Using rule-based insights for now.")
        return base_insights

    cats     = chart_data.get("categories", [])
    series   = chart_data.get("series", [])
    district = slide_data.get("District", "the district")
    data_lines = f"District: {district}\nCategories: {cats}\n"
    for s in series: data_lines += f"{s['name']}: {s['values']}\n"

    descriptions = {
        "tsi_status_trends":        "TSI (Texas Success Initiative) status trends over time",
        "tsi_status":               "TSI status breakdown by campus for the most recent year",
        "tsi_leaderboard":          "TSI assessment pass rates ranked across campuses/districts",
        "ccmr_yoy_breakdown":       "CCMR year-over-year growth (TSI, IBC, Enrollment indicators)",
        "postsecondary_enrollment": "Postsecondary readiness dashboard: college applications, financial aid, FAFSA, and acceptance",
        "ccmr_af_status":           "CCMR A-F accountability status (Met, Approaches, Not Met)",
        "ccmr_pathway":             "CCMR pathway participation breakdown",
        "ccmr_pathway_full":        "All CCMR qualifiers and their participation rates",
        "district_profile":         "District-level metrics across TSI, IBC, College Enrollment, and more",
        "hb3_funds":                "HB3 Outcomes Bonus funding by class year",
    }
    desc   = descriptions.get(slide_type, "K-12 education metrics")
    prompt = (
        f"You are an education data analyst at the Economic Mobility Center. "
        f"Analyze this {desc} data for {district} and provide exactly 3 insights.\n\n"
        f"Format EXACTLY as 3 lines. First 2 lines = key observations (start with •). "
        f"Line 3 = one concrete action step (start with ▶) that begins with an action verb such as Prioritize, Schedule, Connect, Review, Target, Expand, or Monitor. "
        f"Do not put another observation in line 3; it must tell district or campus teams what to do next.\n"
        f"Each line max 25 words. Be specific to the actual numbers.\n\n"
        f"Data:\n{data_lines}"
    )

    client = _anthropic.Anthropic(api_key=api_key)
    last_error = None
    for model in _PREFERRED_MODELS:
        try:
            msg = client.messages.create(
                model=model,
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}]
            )
            text   = msg.content[0].text.strip()
            lines  = [l.strip().lstrip("•▶").strip() for l in text.split("\n") if l.strip() and any(c in l for c in ("•","▶","-","*"))]
            if not lines:
                lines = [l.strip() for l in text.split("\n") if l.strip()]
            result = lines[:3]
            if result:
                print(f"Insights: Claude API ({model}) generated {len(result)} insights for {slide_type}")
                return result
        except Exception as e:
            last_error = e
            print(f"Insights: model {model} failed: {e}")
            continue

    print(f"Insights: all models failed ({last_error}) — using rule-based insights")
    return base_insights


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    api_key = os.environ.get("ANTHROPIC_API_KEY","")
    return {
        "status": "ok",
        "version": "10.0.0",
        "anthropic_installed": _ANTHROPIC_OK,
        "anthropic_api_key_set": bool(api_key),
        "api_key_preview": api_key[:12]+"..." if api_key else "NOT SET",
    }

@app.get("/category-menu")
def get_category_menu(): return {"category_menu": CATEGORY_MENU}

@app.get("/categories")
def get_categories(): return {"categories": list(CATEGORY_MENU.keys())}

@app.get("/slide-fields/{slide_type}")
def get_slide_fields(slide_type: str):
    if slide_type not in SLIDE_REGISTRY: raise HTTPException(404, f"Unknown: {slide_type}")
    return {
        "slide_type": slide_type,
        "fields": ALL_REQUIRED_FIELDS.get(slide_type, []),
        "manual_text_fields": MANUAL_TEXT_FIELDS,
        "supports_modes": SLIDE_REGISTRY[slide_type].get("supports_modes", ["count"]),
        "default_agg": SLIDE_REGISTRY[slide_type].get("default_agg", "district"),
        "needs_data": SLIDE_REGISTRY[slide_type].get("needs_data", True),
    }


@app.post("/inspect-file")
async def inspect_file(slide_type: str = Form(...), file: UploadFile = File(...)):
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in (".xlsx",".xls",".csv"):
        raise HTTPException(400, f"Unsupported file type '{ext}'")
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    upload_path = os.path.join("uploads", f"{ts}_{filename}")
    with open(upload_path, "wb") as buf: shutil.copyfileobj(file.file, buf)

    districts = []
    preview_rows = []; preview_cols = []
    if ext == ".csv":
        df = pd.read_csv(upload_path)
        preview_cols = list(df.columns)
        preview_rows = df.head(5).fillna("").astype(str).values.tolist()
        dist_name = os.path.splitext(filename)[0].replace("_"," ").replace("-"," ")
        districts.append(_inspect_district(df, dist_name, dist_name, slide_type))
    else:
        xl = pd.ExcelFile(upload_path)
        for sname in xl.sheet_names:
            try:
                df = pd.read_excel(xl, sheet_name=sname)
                if not preview_cols:
                    preview_cols = list(df.columns)
                    preview_rows = df.head(5).fillna("").astype(str).values.tolist()
                districts.append(_inspect_district(df, sname, sname, slide_type))
            except Exception as e:
                districts.append({"name":sname,"sheet_name":sname,"campuses":[],"years":[],
                                   "detected_fields":[],"campus_col":None,"usable":False,
                                   "all_required":False,"error":str(e),"row_count":0,"columns":[]})

    return {
        "upload_path": upload_path, "file_ext": ext,
        "districts": districts,
        "preview_cols": preview_cols,
        "preview_rows": preview_rows,
        "manual_text_fields": MANUAL_TEXT_FIELDS,
    }


def _inspect_district(df, district_name, sheet_name, slide_type):
    field_defs = ALL_REQUIRED_FIELDS.get(slide_type, [])
    detected_fields = []; hard_missing = 0
    for field in field_defs:
        detected = _fc(df, field["candidates"])
        optional = field.get("optional", False)
        if not detected and not optional: hard_missing += 1
        detected_fields.append({**field, "detected": detected})
    campus_col = _fc(df, CAMPUS_CANDIDATES)
    campuses = sorted(df[campus_col].dropna().astype(str).unique().tolist()) if campus_col else []
    year_col = _fc(df, ["Class","Year","Graduation Year","Cohort","School Year"])
    years = []
    if year_col:
        raw = pd.to_numeric(df[year_col], errors="coerce").dropna()
        years = sorted(int(y) for y in raw.unique() if 2018 <= y <= 2030)
    total_req = len([f for f in field_defs if not f.get("optional")])
    usable = len(df.columns) > 2 and hard_missing < total_req
    return {"name":district_name,"sheet_name":sheet_name,"campuses":campuses,
            "campus_col":campus_col,"years":years,"detected_fields":detected_fields,
            "all_required":hard_missing==0,"usable":usable,"row_count":len(df),"columns":list(df.columns)}


@app.post("/detect-columns")
async def detect_columns(
    slide_type: str = Form(...), upload_path: str = Form(...),
    selected_districts: str = Form("[]"), selected_campuses: str = Form("{}"),
    aggregation_level: str = Form("district"),
):
    if not os.path.isfile(upload_path): raise HTTPException(400, "File not found.")
    dists = json.loads(selected_districts); camp_map = json.loads(selected_campuses)
    df = _load_selection(upload_path, dists, camp_map)
    field_defs = ALL_REQUIRED_FIELDS.get(slide_type, [])
    detection = [{"key":f["key"],"label":f["label"],"description":f["description"],
                  "optional":f.get("optional",False),"detected":_fc(df,f["candidates"]),
                  "candidates":f["candidates"]} for f in field_defs]
    hard_missing = [f for f in detection if not f["optional"] and not f["detected"]]
    return {"file_columns":list(df.columns),"upload_path":upload_path,
            "fields":detection,"hard_missing":[f["label"] for f in hard_missing],
            "can_proceed":len(hard_missing)==0}


@app.post("/preview-slide")
async def preview_slide(
    slide_type: str = Form(...), upload_path: str = Form(None),
    selected_districts: str = Form("[]"), selected_campuses: str = Form("{}"),
    overrides: str = Form("{}"), manual_text: str = Form("{}"),
    mode: str = Form("count"), aggregation_level: str = Form("district"),
):
    dists=json.loads(selected_districts); camp_map=json.loads(selected_campuses)
    override_map=json.loads(overrides); manual_map=json.loads(manual_text)

    title_defaults = {'cover': 'Cover Slide', 'tsi_status_trends': 'TSI Status Trends', 'tsi_status': 'TSI Status by Campus', 'tsi_leaderboard': 'College Readiness: TSI Leaderboard', 'ccmr_yoy_breakdown': 'CCMR YOY Growth', 'ccmr_af_status': 'CCMR A-F Accountability Status', 'ccmr_pathway': 'CCMR Pathway Analysis', 'postsecondary_enrollment': 'Postsecondary Readiness', 'district_profile': 'Economic Mobility Center District Profile', 'hb3_funds': 'HB3 Outcomes Bonus Funding'}
    STATIC_TYPES = {"cover","mission","methodology","section_divider","agenda"}
    if slide_type in STATIC_TYPES:
        slide_data = {
            "District":     manual_map.get("District",""),
            "subtitle":     manual_map.get("subtitle",""),
            "meeting_type": manual_map.get("meeting_type","Partner Meeting"),
            "Title":        manual_map.get("Title", title_defaults.get(slide_type,"")),
        }
        chart_data = {}; insights = []
    else:
        if not upload_path or not os.path.isfile(upload_path):
            raise HTTPException(400, "File not found. Please upload a data file.")
        df = _load_selection(upload_path, dists, camp_map)
        calc = SLIDE_REGISTRY[slide_type]["calculator"]
        if not calc: raise HTTPException(400, {"error": f"No calculator for {slide_type}"})
        try:
            result = calc(df, overrides=override_map, mode=mode, aggregation_level=aggregation_level)
            if slide_type == "hb3_funds":
                result = _normalize_hb3_payload(result)
        except ValueError as e:
            raise HTTPException(400, {"error": str(e)})
        except Exception as e:
            print(traceback.format_exc()); raise HTTPException(500, {"error": f"Calculation error: {e}"})
        slide_data = result.get("slide_data", {})
        chart_data = result.get("chart_data", {})
        for k, v in manual_map.items():
            if v and str(v).strip(): slide_data[k] = str(v).strip()
        # Add default title if not already set
        if "Title" not in slide_data:
            slide_data["Title"] = title_defaults.get(slide_type, slide_type.replace("_"," ").title())
        insights = _generate_insights(slide_type, chart_data, slide_data, mode)

    return {"slide_data": slide_data, "chart_data": chart_data, "mode": mode, "insights": insights}


@app.post("/generate-slide")
async def generate_slide(
    slide_type: str = Form(...), upload_path: str = Form(None),
    selected_districts: str = Form("[]"), selected_campuses: str = Form("{}"),
    overrides: str = Form("{}"), manual_text: str = Form("{}"),
    mode: str = Form("count"), aggregation_level: str = Form("district"),
    preview_slide_data: str = Form(None), preview_chart_data: str = Form(None),
    preview_insights: str = Form("[]"),
):
    dists=json.loads(selected_districts); camp_map=json.loads(selected_campuses)
    override_map=json.loads(overrides); manual_map=json.loads(manual_text)
    insights = json.loads(preview_insights) if preview_insights else []
    month      = manual_map.get("month","")
    year_lbl   = manual_map.get("year_label","")
    data_src   = manual_map.get("data_source","")
    as_of      = manual_map.get("as_of_date","")
    extra_note = manual_map.get("footnote","")
    # Assemble footnote: "Source: X as of Y. extra_note"
    footnote_parts = []
    if data_src: footnote_parts.append(f"Source: {data_src}" + (f" as of {as_of}." if as_of else "."))
    elif as_of:  footnote_parts.append(f"As of {as_of}.")
    if extra_note: footnote_parts.append(extra_note)
    footnote = " ".join(footnote_parts)

    if preview_slide_data and preview_chart_data:
        slide_data    = json.loads(preview_slide_data)
        chart_payload = json.loads(preview_chart_data)
    elif slide_type == "cover":
        slide_data = {"District":manual_map.get("District",""),"subtitle":manual_map.get("subtitle",""),
                      "meeting_type":manual_map.get("meeting_type","Partner Meeting")}
        chart_payload = {}
    else:
        if not upload_path or not os.path.isfile(upload_path):
            raise HTTPException(400, {"error": "No file provided."})
        df = _load_selection(upload_path, dists, camp_map)
        calc = SLIDE_REGISTRY[slide_type]["calculator"]
        try:
            result = calc(df, overrides=override_map, mode=mode, aggregation_level=aggregation_level)
            if slide_type == "hb3_funds":
                result = _normalize_hb3_payload(result)
        except Exception as e:
            print(traceback.format_exc()); raise HTTPException(500, {"error": str(e)})
        slide_data = result.get("slide_data",{}); chart_payload = result.get("chart_data",{})
        for k, v in manual_map.items():
            if v and str(v).strip(): slide_data[k] = str(v).strip()
        if not insights:
            insights = _generate_insights(slide_type, chart_payload, slide_data, mode)

    html_content = generate_html(
        slide_type=slide_type, slide_data=slide_data, chart_data=chart_payload,
        mode=mode, layout=SLIDE_REGISTRY[slide_type]["layout"],
        insights=insights, month=month, year=year_lbl, footnote=footnote,
        title=slide_data.get("Title",""),
    )
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_name = f"{slide_type}_{ts}.html"
    out_path = os.path.join("outputs", out_name)
    with open(out_path, "w", encoding="utf-8") as f: f.write(html_content)
    return FileResponse(out_path, filename=out_name, media_type="text/html")


@app.post("/generate-insights")
async def generate_insights_endpoint(
    slide_type: str = Form(...),
    chart_data_json: str = Form("{}"),
    slide_data_json: str = Form("{}"),
    mode: str = Form("percent"),
):
    """Generate insights from user-edited chart data (series names included)."""
    try:
        chart_data = json.loads(chart_data_json)
        slide_data = json.loads(slide_data_json)
        insights = _generate_insights(slide_type, chart_data, slide_data, mode)
        return {"insights": insights}
    except Exception as e:
        raise HTTPException(500, str(e))



@app.post("/ask-claude-data")
async def ask_claude_data(
    slide_type: str = Form(...),
    upload_path: str = Form(...),
    selected_districts: str = Form("[]"),
    selected_campuses: str = Form("{}"),
    overrides: str = Form("{}"),
    manual_text: str = Form("{}"),
    mode: str = Form("count"),
    aggregation_level: str = Form("district"),
    question: str = Form(...),
):
    """
    Ask Claude a question about the currently loaded/selected dataset.

    This sends Claude a compact dataset context, not the full workbook.
    """
    if not _ANTHROPIC_OK:
        raise HTTPException(503, "Claude is not available because the anthropic package is not installed.")

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(503, "Claude is not configured because ANTHROPIC_API_KEY is not set.")

    if not upload_path or not os.path.isfile(upload_path):
        raise HTTPException(400, "No uploaded dataset found. Upload a data file before asking Claude.")

    q = (question or "").strip()
    if not q:
        raise HTTPException(400, "Question cannot be blank.")
    if len(q) > 1500:
        raise HTTPException(400, "Question is too long. Please keep it under 1,500 characters.")

    try:
        dists = json.loads(selected_districts)
        camp_map = json.loads(selected_campuses)
        override_map = json.loads(overrides)
        manual_map = json.loads(manual_text)
    except Exception:
        raise HTTPException(400, "Invalid request metadata.")

    try:
        df = _load_selection(upload_path, dists, camp_map)
    except Exception as e:
        raise HTTPException(400, f"Could not load selected data: {e}")

    if df is None or df.empty:
        raise HTTPException(400, "The selected dataset is empty.")

    max_rows = min(len(df), 35)
    sample = df.head(max_rows).fillna("").astype(str)
    columns = [str(c) for c in df.columns]

    numeric_summary = {}
    try:
        numeric_df = df.select_dtypes(include="number")
        if not numeric_df.empty:
            numeric_summary = {
                str(col): {
                    "count": int(numeric_df[col].count()),
                    "mean": round(float(numeric_df[col].mean()), 3) if pd.notna(numeric_df[col].mean()) else None,
                    "min": round(float(numeric_df[col].min()), 3) if pd.notna(numeric_df[col].min()) else None,
                    "max": round(float(numeric_df[col].max()), 3) if pd.notna(numeric_df[col].max()) else None,
                }
                for col in list(numeric_df.columns)[:25]
            }
    except Exception:
        numeric_summary = {}

    value_counts = {}
    try:
        for col in columns[:35]:
            series = df[col].dropna().astype(str).str.strip()
            if 0 < series.nunique() <= 20:
                value_counts[col] = series.value_counts().head(12).to_dict()
    except Exception:
        value_counts = {}

    calculated_payload = {}
    try:
        calc = SLIDE_REGISTRY.get(slide_type, {}).get("calculator")
        if calc:
            calculated_payload = calc(df, overrides=override_map, mode=mode, aggregation_level=aggregation_level)
            if slide_type == "hb3_funds":
                calculated_payload = _normalize_hb3_payload(calculated_payload)
    except Exception as e:
        calculated_payload = {"calculation_error": str(e)}

    data_context = {
        "slide_type": slide_type,
        "mode": mode,
        "aggregation_level": aggregation_level,
        "manual_text": manual_map,
        "selected_districts": dists,
        "selected_campuses": camp_map,
        "row_count": int(len(df)),
        "column_count": int(len(df.columns)),
        "columns": columns,
        "numeric_summary": numeric_summary,
        "value_counts_for_small_categorical_columns": value_counts,
        "calculated_slide_payload": calculated_payload,
        "sample_rows": sample.to_dict(orient="records"),
    }

    prompt = (
        "You are Claude, acting as an education data analyst inside the EMC slide generator. "
        "Answer the user's question using ONLY the dataset context provided below. "
        "When calculating percentages, clearly state numerator, denominator, and formula. "
        "If the requested calculation cannot be made from the available columns, say exactly what column or definition is missing. "
        "Keep the answer concise and practical. Do not invent data.\\n\\n"
        f"USER QUESTION:\\n{q}\\n\\n"
        f"DATASET CONTEXT JSON:\\n{json.dumps(data_context, ensure_ascii=False)[:90000]}"
    )

    client = _anthropic.Anthropic(api_key=api_key)
    last_error = None
    for model in _PREFERRED_MODELS:
        try:
            msg = client.messages.create(
                model=model,
                max_tokens=700,
                messages=[{"role": "user", "content": prompt}]
            )
            answer = msg.content[0].text.strip()
            return {
                "answer": answer,
                "model": model,
                "row_count": int(len(df)),
                "sample_rows_used": max_rows,
            }
        except Exception as e:
            last_error = e
            print(f"Ask Claude: model {model} failed: {e}")
            continue

    raise HTTPException(502, f"Claude request failed: {last_error}")

@app.post("/preview-slide-html")
async def preview_slide_html(
    slide_type: str = Form(...), upload_path: str = Form(""),
    selected_districts: str = Form("[]"), selected_campuses: str = Form("{}"),
    col_map: str = Form("{}"), mode: str = Form("percent"),
    manual_map_json: str = Form("{}"), insights_json: str = Form("[]"),
    slide_data_json: str = Form("{}"), chart_data_json: str = Form("{}"),
):
    """Return slide HTML string directly for iframe preview in the browser."""
    try:
        manual_map  = json.loads(manual_map_json)
        insights    = json.loads(insights_json)
        slide_data  = json.loads(slide_data_json)
        chart_data  = json.loads(chart_data_json)
        month       = manual_map.get("month","")
        year_lbl    = manual_map.get("year_label","")
        data_src    = manual_map.get("data_source","")
        as_of       = manual_map.get("as_of_date","")
        extra_note  = manual_map.get("footnote","")
        parts = []
        if data_src: parts.append(f"Source: {data_src}" + (f" as of {as_of}." if as_of else "."))
        if extra_note: parts.append(extra_note)
        footnote = " ".join(parts)
        title = slide_data.get("Title","")
        layout = SLIDE_REGISTRY.get(slide_type, {}).get("layout", "tsi_stacked_column")
        html_content = generate_html(
            slide_type=slide_type, slide_data=slide_data, chart_data=chart_data,
            mode=mode, layout=layout, insights=insights,
            month=month, year=year_lbl, footnote=footnote, title=title,
        )
        from fastapi.responses import HTMLResponse
        return HTMLResponse(content=html_content)
    except Exception as e:
        raise HTTPException(500, str(e))



def _apply_auto_inserts_for_export(slides_config, auto_inserts=True):
    """Apply the same auto-insert rules used by the HTML presentation export."""
    slides_config = list(slides_config or [])
    if not auto_inserts or not slides_config:
        return slides_config

    CATEGORY_ORDER = {
        "cover":["Cover & Section"],"mission":["Cover & Section"],"agenda":["Cover & Section"],
        "tsi_status_trends":["TSI"],"tsi_status":["TSI"],"tsi_leaderboard":["TSI"],
        "ccmr_yoy_breakdown":["CCMR"],"ccmr_af_status":["CCMR"],"ccmr_pathway":["CCMR"],"ccmr_pathway_full":["CCMR"],
        "district_profile":["District Profile"],
        "postsecondary_enrollment":["Postsecondary"],
        "hb3_funds":["HB3 Funding"],
        "outro":["Closing"],
    }
    CLEAN_NAMES = {
        "tsi_status_trends":       "TSI Status Trends",
        "tsi_status":              "TSI Status by Campus",
        "tsi_leaderboard":         "TSI Leaderboard",
        "ccmr_yoy_breakdown":      "CCMR YOY Growth",
        "ccmr_af_status":          "CCMR A-F Status",
        "ccmr_pathway":            "CCMR Pathway Analysis",
        "ccmr_pathway_full":       "CCMR All Qualifiers",
        "district_profile":        "EMC District Profile",
        "postsecondary_enrollment":"Postsecondary Readiness",
        "hb3_funds":               "HB3 Outcomes Bonus Funding",
        "outro":                   "Closing",
    }

    agenda_list = [
        {
            "name": CLEAN_NAMES.get(sc.get("slide_type"), str(sc.get("slide_type","Slide")).replace("_"," ").title()),
            "category": CATEGORY_ORDER.get(sc.get("slide_type"), ["Other"])[0],
            "icon": "📊",
        }
        for sc in slides_config
        if sc.get("slide_type") not in ("cover","agenda","methodology","section_divider","mission","outro")
    ]

    cover_idx = next((i for i, sc in enumerate(slides_config) if sc.get("slide_type") == "cover"), -1)
    if agenda_list and not any(sc.get("slide_type") == "agenda" for sc in slides_config):
        agenda_sc = {
            "slide_type":"agenda",
            "slide_data":{"District":"","Title":"Agenda","slides_list":agenda_list},
            "chart_data":{},
            "mode":"percent",
            "layout":"agenda",
            "insights":[],
            "month":"",
            "year_label":"",
            "footnote":"",
        }
        insert_at = cover_idx + 1 if cover_idx >= 0 else 0
        slides_config.insert(insert_at, agenda_sc)

    prev_cat = None
    result = []
    for sc in slides_config:
        cur_cat = CATEGORY_ORDER.get(sc.get("slide_type"), ["Other"])[0]
        if cur_cat not in ("Cover & Section",) and cur_cat != prev_cat and prev_cat is not None:
            div_title = {
                "TSI":"Texas Success Initiative",
                "CCMR":"College, Career & Military Readiness",
                "District Profile":"District Profile",
                "Postsecondary":"Postsecondary Enrollment",
                "HB3 Funding":"HB3 Outcomes Bonus",
                "Closing":"Closing",
                "Other":"Analytics",
            }.get(cur_cat, cur_cat)
            result.append({
                "slide_type":"section_divider",
                "slide_data":{"Title":div_title,"District":""},
                "chart_data":{},
                "mode":"percent",
                "layout":"section_divider",
                "insights":[],
                "month":"",
                "year_label":"",
                "footnote":"",
            })
        result.append(sc)
        prev_cat = cur_cat

    if not any(sc.get("slide_type") == "methodology" for sc in result):
        result.append({
            "slide_type":"methodology",
            "slide_data":{"Title":"Methodology"},
            "chart_data":{},
            "mode":"percent",
            "layout":"methodology",
            "insights":[],
            "month":"",
            "year_label":"",
            "footnote":"",
        })
    return result

@app.post("/generate-presentation")
async def generate_presentation(payload: str = Form(...), auto_inserts: str = Form("true")):
    """
    Build a multi-slide HTML slideshow.
    payload = JSON array of {slide_type, slide_data, chart_data, mode, layout, insights, month, year_label, footnote}
    """
    try:
        slides_config = json.loads(payload)
    except Exception:
        raise HTTPException(400, {"error": "Invalid payload JSON"})

    do_auto = auto_inserts.lower() != "false"
    if do_auto and slides_config:
        # Auto-insert: agenda after cover, section dividers between categories, methodology at end
        CATEGORY_ORDER = {
            "cover":["Cover & Section"],"mission":["Cover & Section"],"agenda":["Cover & Section"],
            "tsi_status_trends":["TSI"],"tsi_status":["TSI"],"tsi_leaderboard":["TSI"],
            "ccmr_yoy_breakdown":["CCMR"],"ccmr_af_status":["CCMR"],"ccmr_pathway":["CCMR"],"ccmr_pathway_full":["CCMR"],
            "district_profile":["District Profile"],
            "postsecondary_enrollment":["Postsecondary"],
            "hb3_funds":["HB3 Funding"],
        }
        # Build agenda slide from all user-selected slides
        # Clean display names for agenda — use short slide type name, not data-derived title
        CLEAN_NAMES = {
            "tsi_status_trends":       "TSI Status Trends",
            "tsi_status":              "TSI Status by Campus",
            "tsi_leaderboard":         "TSI Leaderboard",
            "ccmr_yoy_breakdown":      "CCMR YOY Growth",
            "ccmr_af_status":          "CCMR A-F Status",
            "ccmr_pathway":            "CCMR Pathway Analysis",
            "ccmr_pathway_full":       "CCMR All Qualifiers",
            "district_profile":        "EMC District Profile",
            "postsecondary_enrollment":"Postsecondary Readiness",
            "hb3_funds":               "HB3 Outcomes Bonus Funding",
            "outro":                   "Closing",
        }
        agenda_list = [{"name": CLEAN_NAMES.get(sc["slide_type"], sc["slide_type"].replace("_"," ").title()),
                        "category": CATEGORY_ORDER.get(sc["slide_type"],["Other"])[0], "icon":"📊"}
                       for sc in slides_config
                       if sc["slide_type"] not in ("cover","agenda","methodology","section_divider","mission","outro")]

        # Inject agenda after first cover (or at start)
        cover_idx = next((i for i,sc in enumerate(slides_config) if sc["slide_type"]=="cover"), -1)
        if agenda_list and not any(sc["slide_type"]=="agenda" for sc in slides_config):
            agenda_sc = {"slide_type":"agenda","slide_data":{"District":"","Title":"Agenda","slides_list":agenda_list},"chart_data":{},"mode":"percent","layout":"agenda","insights":[],"month":"","year_label":"","footnote":""}
            insert_at = cover_idx+1 if cover_idx>=0 else 0
            slides_config.insert(insert_at, agenda_sc)

        # Insert section dividers between category changes
        prev_cat = None
        result = []
        for sc in slides_config:
            cur_cats = CATEGORY_ORDER.get(sc["slide_type"],["Other"])
            cur_cat  = cur_cats[0]
            if cur_cat not in ("Cover & Section",) and cur_cat != prev_cat and prev_cat is not None:
                div_title = {"TSI":"Texas Success Initiative","CCMR":"College, Career & Military Readiness","District Profile":"District Profile","Postsecondary":"Postsecondary Enrollment","HB3 Funding":"HB3 Outcomes Bonus","Other":"Analytics"}.get(cur_cat, cur_cat)
                result.append({"slide_type":"section_divider","slide_data":{"Title":div_title,"District":""},"chart_data":{},"mode":"percent","layout":"section_divider","insights":[],"month":"","year_label":"","footnote":""})
            result.append(sc)
            prev_cat = cur_cat
        slides_config = result

        # Append methodology slide at end if not already there
        if not any(sc["slide_type"]=="methodology" for sc in slides_config):
            slides_config.append({"slide_type":"methodology","slide_data":{"Title":"Methodology"},"chart_data":{},"mode":"percent","layout":"methodology","insights":[],"month":"","year_label":"","footnote":""})

    slide_bodies = []
    for sc in slides_config:
        html = generate_html(
            slide_type  = sc.get("slide_type","tsi_status_trends"),
            slide_data  = sc.get("slide_data",{}),
            chart_data  = sc.get("chart_data",{}),
            mode        = sc.get("mode","percent"),
            layout      = sc.get("layout","tsi_stacked_column"),
            insights    = sc.get("insights",[]),
            month       = sc.get("month",""),
            year        = sc.get("year_label",""),
            footnote    = sc.get("footnote",""),
            title       = sc.get("slide_data",{}).get("Title",""),
        )
        # Extract the <div class="slide"...> from the full HTML
        start = html.find('<div class="slide"')
        end   = html.rfind("</div>") + 6
        body  = html[start:end] if start >= 0 else html
        slide_bodies.append({"body_html": body, "title": sc.get("slide_data",{}).get("District","Slide")})

    pres_html = generate_presentation_html(slide_bodies)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_name = f"presentation_{ts}.html"
    out_path = os.path.join("outputs", out_name)
    with open(out_path, "w", encoding="utf-8") as f: f.write(pres_html)
    return FileResponse(out_path, filename=out_name, media_type="text/html")




@app.post("/generate-slide-pptx")
async def generate_slide_pptx(
    slide_type: str = Form(...), upload_path: str = Form(None),
    selected_districts: str = Form("[]"), selected_campuses: str = Form("{}"),
    overrides: str = Form("{}"), manual_text: str = Form("{}"),
    mode: str = Form("count"), aggregation_level: str = Form("district"),
    preview_slide_data: str = Form(None), preview_chart_data: str = Form(None),
    preview_insights: str = Form("[]"),
):
    """Generate a single editable PowerPoint slide."""
    dists=json.loads(selected_districts); camp_map=json.loads(selected_campuses)
    override_map=json.loads(overrides); manual_map=json.loads(manual_text)
    insights = json.loads(preview_insights) if preview_insights else []
    month      = manual_map.get("month","")
    year_lbl   = manual_map.get("year_label","")
    data_src   = manual_map.get("data_source","")
    as_of      = manual_map.get("as_of_date","")
    extra_note = manual_map.get("footnote","")
    footnote_parts = []
    if data_src: footnote_parts.append(f"Source: {data_src}" + (f" as of {as_of}." if as_of else "."))
    elif as_of:  footnote_parts.append(f"As of {as_of}.")
    if extra_note: footnote_parts.append(extra_note)
    footnote = " ".join(footnote_parts)

    title_defaults = {'cover': 'Cover Slide', 'tsi_status_trends': 'TSI Status Trends', 'tsi_status': 'TSI Status by Campus', 'tsi_leaderboard': 'College Readiness: TSI Leaderboard', 'ccmr_yoy_breakdown': 'CCMR YOY Growth', 'ccmr_af_status': 'CCMR A-F Accountability Status', 'ccmr_pathway': 'CCMR Pathway Analysis', 'postsecondary_enrollment': 'Postsecondary Readiness', 'district_profile': 'Economic Mobility Center District Profile', 'hb3_funds': 'HB3 Outcomes Bonus Funding'}
    STATIC_TYPES = {"cover","mission","methodology","section_divider","agenda","outro"}

    if preview_slide_data and preview_chart_data:
        slide_data    = json.loads(preview_slide_data)
        chart_payload = json.loads(preview_chart_data)
    elif slide_type in STATIC_TYPES:
        slide_data = {
            "District":     manual_map.get("District",""),
            "subtitle":     manual_map.get("subtitle",""),
            "meeting_type": manual_map.get("meeting_type","Partner Meeting"),
            "Title":        manual_map.get("Title", title_defaults.get(slide_type,"")),
        }
        chart_payload = {}
    else:
        if not upload_path or not os.path.isfile(upload_path):
            raise HTTPException(400, {"error": "No file provided."})
        df = _load_selection(upload_path, dists, camp_map)
        calc = SLIDE_REGISTRY[slide_type]["calculator"]
        try:
            result = calc(df, overrides=override_map, mode=mode, aggregation_level=aggregation_level)
            if slide_type == "hb3_funds":
                result = _normalize_hb3_payload(result)
        except Exception as e:
            print(traceback.format_exc()); raise HTTPException(500, {"error": str(e)})
        slide_data = result.get("slide_data",{}); chart_payload = result.get("chart_data",{})
        for k, v in manual_map.items():
            if v and str(v).strip(): slide_data[k] = str(v).strip()
        if not insights:
            insights = _generate_insights(slide_type, chart_payload, slide_data, mode)

    if "Title" not in slide_data:
        slide_data["Title"] = title_defaults.get(slide_type, slide_type.replace("_"," ").title())

    slide_config = [{
        "slide_type": slide_type,
        "slide_data": slide_data,
        "chart_data": chart_payload,
        "mode": mode,
        "layout": SLIDE_REGISTRY.get(slide_type, {}).get("layout", slide_type),
        "insights": insights,
        "month": month,
        "year_label": year_lbl,
        "footnote": _clean_source_footnote(footnote),
    }]
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_name = f"{slide_type}_{ts}.pptx"
    out_path = os.path.join("outputs", out_name)
    generate_pptx_file(slide_config, out_path)
    return FileResponse(
        out_path,
        filename=out_name,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )


@app.post("/generate-presentation-pptx")
async def generate_presentation_pptx(payload: str = Form(...), auto_inserts: str = Form("true")):
    """Build an editable PowerPoint deck from approved slide configs."""
    try:
        slides_config = json.loads(payload)
    except Exception:
        raise HTTPException(400, {"error": "Invalid payload JSON"})

    slides_config = _apply_auto_inserts_for_export(slides_config, auto_inserts.lower() != "false")
    if not slides_config:
        raise HTTPException(400, {"error": "No slides provided."})

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_name = f"presentation_{ts}.pptx"
    out_path = os.path.join("outputs", out_name)
    generate_pptx_file(slides_config, out_path)
    return FileResponse(
        out_path,
        filename=out_name,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )



def _presentation_title_defaults():
    return {
        'cover': 'Cover Slide',
        'mission': 'EMC Mission',
        'outro': 'Thank You',
        'tsi_status_trends': 'TSI Status Trends',
        'tsi_status': 'TSI Status by Campus',
        'tsi_leaderboard': 'College Readiness: TSI Leaderboard',
        'ccmr_yoy_breakdown': 'CCMR YOY Growth',
        'ccmr_af_status': 'CCMR A-F Accountability Status',
        'ccmr_pathway': 'CCMR Pathway Analysis',
        'ccmr_pathway_full': 'CCMR All Qualifiers',
        'postsecondary_enrollment': 'Postsecondary Readiness',
        'district_profile': 'Economic Mobility Center District Profile',
        'hb3_funds': 'HB3 Outcomes Bonus Funding',
        'methodology': 'Methodology',
        'agenda': 'Agenda',
        'section_divider': 'Section Divider',
    }


def _footnote_from_manual_map(manual_map):
    manual_map = manual_map or {}
    data_src   = str(manual_map.get("data_source", "") or "").strip()
    as_of      = str(manual_map.get("as_of_date", "") or "").strip()
    extra_note = str(manual_map.get("footnote", "") or "").strip()
    parts = []
    if data_src:
        parts.append(f"Source: {data_src}" + (f" as of {as_of}." if as_of else "."))
    elif as_of:
        parts.append(f"As of {as_of}.")
    if extra_note:
        parts.append(extra_note)
    return _clean_source_footnote(" ".join(parts))


def _auto_selected_districts(upload_path, slide_type):
    """Choose a workbook sheet quickly for one-click full presentation generation.

    The previous implementation inspected every tab in large workbooks, which made
    Generate Full HTML Now appear to hang. Quick generation should be fast, so use
    the first sheet by default. Slide-specific column detection still happens after
    the sheet is loaded.
    """
    ext = os.path.splitext(upload_path)[1].lower()
    if ext == ".csv":
        return []
    try:
        xl = pd.ExcelFile(upload_path)
        return xl.sheet_names[:1]
    except Exception:
        return []

def _auto_slide_config_from_plan(item):
    item = item or {}
    slide_type = item.get("slide_type", "")
    if slide_type not in SLIDE_REGISTRY:
        raise ValueError(f"Unknown slide type: {slide_type}")

    registry = SLIDE_REGISTRY[slide_type]
    manual_map = item.get("manual_text") or {}
    title_defaults = _presentation_title_defaults()
    static_types = {"cover", "mission", "methodology", "section_divider", "agenda", "outro"}
    supports = registry.get("supports_modes", ["count"])
    mode = item.get("mode") or ("count" if slide_type == "hb3_funds" else ("percent" if "percent" in supports else supports[0]))
    aggregation_level = item.get("aggregation_level") or registry.get("default_agg", "district")
    month = str(manual_map.get("month", "") or "")
    year_label = str(manual_map.get("year_label", "") or "")
    footnote = _footnote_from_manual_map(manual_map)

    if slide_type in static_types or registry.get("needs_data") is False:
        slide_data = {
            "District": str(manual_map.get("District", "") or ""),
            "subtitle": str(manual_map.get("subtitle", "") or ""),
            "meeting_type": str(manual_map.get("meeting_type", "Partner Meeting") or "Partner Meeting"),
            "Title": str(manual_map.get("Title", title_defaults.get(slide_type, slide_type.replace("_", " ").title())) or ""),
        }
        chart_payload = {}
        insights = []
    else:
        upload_path = item.get("upload_path") or ""
        if not upload_path or not os.path.isfile(upload_path):
            raise ValueError(f"No valid data file assigned for {title_defaults.get(slide_type, slide_type)}.")
        selected_districts = item.get("selected_districts")
        if selected_districts is None:
            selected_districts = _auto_selected_districts(upload_path, slide_type)
        selected_campuses = item.get("selected_campuses") or {}
        df = _load_selection(upload_path, selected_districts, selected_campuses)

        override_map = item.get("overrides") or {}
        for field in ALL_REQUIRED_FIELDS.get(slide_type, []):
            if not override_map.get(field.get("key")):
                detected = _fc(df, field.get("candidates", []))
                if detected:
                    override_map[field.get("key")] = detected

        calc = registry.get("calculator")
        if not calc:
            raise ValueError(f"No calculator for {slide_type}.")
        result = calc(df, overrides=override_map, mode=mode, aggregation_level=aggregation_level)
        if slide_type == "hb3_funds":
            result = _normalize_hb3_payload(result)
        slide_data = result.get("slide_data", {}) or {}
        chart_payload = result.get("chart_data", {}) or {}
        for k, v in manual_map.items():
            if v is not None and str(v).strip():
                slide_data[k] = str(v).strip()
        if "Title" not in slide_data:
            slide_data["Title"] = title_defaults.get(slide_type, slide_type.replace("_", " ").title())
        insights = _generate_insights(slide_type, chart_payload, slide_data, mode)

    return {
        "slide_type": slide_type,
        "slide_data": slide_data,
        "chart_data": chart_payload,
        "mode": mode,
        "layout": registry.get("layout", slide_type),
        "insights": insights,
        "month": month,
        "year_label": year_label,
        "footnote": footnote,
    }


def _auto_slide_configs_from_payload(payload):
    try:
        plan = json.loads(payload)
    except Exception:
        raise HTTPException(400, {"error": "Invalid payload JSON"})
    if not isinstance(plan, list) or not plan:
        raise HTTPException(400, {"error": "No slides selected."})
    configs = []
    for idx, item in enumerate(plan, start=1):
        try:
            configs.append(_auto_slide_config_from_plan(item))
        except Exception as e:
            raise HTTPException(400, {"error": f"Slide {idx}: {e}"})
    return configs


@app.post("/generate-presentation-auto")
async def generate_presentation_auto(payload: str = Form(...), auto_inserts: str = Form("true")):
    """Generate a full HTML presentation directly from selected slides and assigned uploaded files."""
    try:
        slides_config = _auto_slide_configs_from_payload(payload)
        slides_config = _apply_auto_inserts_for_export(slides_config, auto_inserts.lower() != "false")

        slide_bodies = []
        for sc in slides_config:
            html = generate_html(
                slide_type=sc.get("slide_type", "tsi_status_trends"),
                slide_data=sc.get("slide_data", {}),
                chart_data=sc.get("chart_data", {}),
                mode=sc.get("mode", "percent"),
                layout=sc.get("layout", "tsi_stacked_column"),
                insights=sc.get("insights", []),
                month=sc.get("month", ""),
                year=sc.get("year_label", ""),
                footnote=sc.get("footnote", ""),
                title=sc.get("slide_data", {}).get("Title", ""),
            )
            start = html.find('<div class="slide"')
            end = html.rfind("</div>") + 6
            body = html[start:end] if start >= 0 and end > start else html
            slide_bodies.append({"body_html": body, "title": sc.get("slide_data", {}).get("District", "Slide")})

        pres_html = generate_presentation_html(slide_bodies)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_name = f"presentation_{ts}.html"
        out_path = os.path.join("outputs", out_name)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(pres_html)
        return FileResponse(out_path, filename=out_name, media_type="text/html; charset=utf-8", headers={"Cache-Control":"no-store"})
    except HTTPException:
        raise
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(500, {"error": str(e)})


@app.post("/generate-presentation-pptx-auto")
async def generate_presentation_pptx_auto(payload: str = Form(...), auto_inserts: str = Form("true")):
    """Generate a full editable PowerPoint directly from selected slides and assigned uploaded files."""
    slides_config = _auto_slide_configs_from_payload(payload)
    slides_config = _apply_auto_inserts_for_export(slides_config, auto_inserts.lower() != "false")
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_name = f"presentation_{ts}.pptx"
    out_path = os.path.join("outputs", out_name)
    generate_pptx_file(slides_config, out_path)
    return FileResponse(
        out_path,
        filename=out_name,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )

# ── Data loading ──────────────────────────────────────────────────────────────
def _load_df_sheet(path, sheet_name=None):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".csv":   return pd.read_csv(path)
    elif ext == ".xls": return pd.read_excel(path, engine="xlrd", sheet_name=sheet_name or 0)
    else:               return pd.read_excel(path, sheet_name=sheet_name or 0)

def _load_selection(path, districts, campus_map):
    ext = os.path.splitext(path)[1].lower()
    if not districts: return _load_df_sheet(path, None)
    if ext == ".csv":
        df = pd.read_csv(path)
        all_c = [c for lst in campus_map.values() for c in lst]
        if all_c and (cc := _fc(df, CAMPUS_CANDIDATES)):
            df = df[df[cc].astype(str).isin(all_c)]
        return df
    frames = []
    multi = len(districts) > 1
    for sname in districts:
        try:
            df = pd.read_excel(path, sheet_name=sname)
            df["_district_display_name"] = sname
            if multi: df["_district_name"] = sname
            campus_list = campus_map.get(sname, [])
            if campus_list and (cc := _fc(df, CAMPUS_CANDIDATES)):
                df = df[df[cc].astype(str).isin(campus_list)]
            frames.append(df)
        except Exception as e:
            print(f"Warning: could not load '{sname}': {e}")
    if not frames: raise ValueError(f"Could not load any of: {districts}")
    return pd.concat(frames, ignore_index=True)
