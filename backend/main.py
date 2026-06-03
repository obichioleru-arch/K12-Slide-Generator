"""District Slide Tool — Backend v10"""

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

import pandas as pd, shutil, os, json, traceback
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
from calculations.ccmr_pathway_full import (
    calculate_ccmr_pathway_full, REQUIRED_FIELDS as PATHWAY_FULL_FIELDS,
)
from calculations.district_profile import (
    calculate_district_profile, REQUIRED_FIELDS as PROFILE_FIELDS,
)
from calculations.hb3 import (
    calculate_hb3_funds, REQUIRED_FIELDS as HB3_FIELDS,
)
from calculations.by_the_numbers import (
    calculate_by_the_numbers, REQUIRED_FIELDS as BTN_FIELDS,
)
from insights import compute_insights

app = FastAPI(title="District Slide Tool", version="10.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    "By the Numbers": [
        {"slide_name": "By the Numbers", "slide_type": "by_the_numbers"},
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
ALL_REQUIRED_FIELDS["ccmr_af_status"]  = CCMR_FIELDS.get("ccmr_yoy_breakdown", [])
ALL_REQUIRED_FIELDS.update(PATHWAY_FULL_FIELDS)
ALL_REQUIRED_FIELDS.update(PROFILE_FIELDS)
ALL_REQUIRED_FIELDS.update(HB3_FIELDS)
ALL_REQUIRED_FIELDS.update(BTN_FIELDS)
ALL_REQUIRED_FIELDS["ccmr_pathway"] = [
    {"key":"tsi","label":"CCMR TSI Status",
     "description":"TSI indicator column. Values: Met, Not Met",
     "candidates":["CCMR TSI Status","TSI Status","TSI"]},
    {"key":"year","label":"Year",
     "description":"Graduation class year column (e.g. 'Class')",
     "candidates":["Class","Year","Graduation Year","Cohort","School Year"]},
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


# ── New calculators ───────────────────────────────────────────────────────────
def _calc_ccmr_af(df, overrides=None, mode="percent", aggregation_level="district"):
    """CCMR A-F Status: Met / Approaches / Not Met counts."""
    from calculations.ccmr import _find_column
    overrides = overrides or {}
    tsi_col = overrides.get("tsi") or _find_column(df, ["CCMR TSI Status","TSI Status","TSI"])
    dist_col = _find_column(df, ["_district_display_name","_district_name"] + CAMPUS_CANDIDATES)
    district_name = str(df[dist_col].dropna().iloc[0]) if dist_col and len(df[dist_col].dropna()) else "District"
    if not tsi_col:
        raise ValueError("Could not find TSI Status column.")
    vals = df[tsi_col].astype(str).str.strip().str.lower()
    met     = int((vals == "met").sum())
    app     = int((vals.isin(["approaches","approaches met"])).sum())
    notmet  = int((vals == "not met").sum())
    return {
        "slide_data": {"District": district_name, "Campus": district_name},
        "chart_data": {"categories":["Met","Approaches","Not Met"],
                       "series":[{"name":"Students","values":[met,app,notmet]}], "mode":"count"},
    }


def _calc_ccmr_pathway(df, overrides=None, mode="count", aggregation_level="campus"):
    """CCMR Pathway Analysis: on-pathway breakdown."""
    from calculations.ccmr import _find_column
    overrides = overrides or {}
    tsi_col   = overrides.get("tsi")   or _find_column(df, ["CCMR TSI Status","TSI Status","TSI"])
    dual_col  = _find_column(df, ["CCMR Dual Credit Status","Dual Credit Status","Dual Credit"])
    ap_col    = _find_column(df, ["CCMR AP/IB Status","AP Status","IB Status","AP/IB"])
    ibc_col   = _find_column(df, ["CCMR Certification Status","IBC","IBC Status"])
    dist_col  = _find_column(df, ["_district_display_name","_district_name"] + CAMPUS_CANDIDATES)
    district_name = str(df[dist_col].dropna().iloc[0]) if dist_col and len(df[dist_col].dropna()) else "District"

    def count_met(col):
        if not col or col not in df.columns: return 0
        return int(df[col].astype(str).str.strip().str.lower().isin(["met","yes","true","1"]).sum())

    tsi_met  = count_met(tsi_col)
    dual_met = count_met(dual_col)
    ap_met   = count_met(ap_col)
    ibc_met  = count_met(ibc_col)

    total = len(df)
    on_pathway = int(df.apply(lambda row: any([
        str(row.get(tsi_col,"")).strip().lower()  == "met" if tsi_col  else False,
        str(row.get(dual_col,"")).strip().lower() == "met" if dual_col else False,
        str(row.get(ap_col,"")).strip().lower()   == "met" if ap_col   else False,
        str(row.get(ibc_col,"")).strip().lower()  == "met" if ibc_col  else False,
    ]), axis=1).sum())
    not_pathway = total - on_pathway

    return {
        "slide_data": {"District": district_name, "Campus": district_name},
        "chart_data": {"categories":["On Pathway","Not on Pathway","Dual Credit","TSI","AP/IB","IBC"],
                       "series":[{"name":"Students","values":[on_pathway,not_pathway,dual_met,tsi_met,ap_met,ibc_met]}],
                       "mode":"count"},
    }



SLIDE_REGISTRY = {
    "cover":                   {"calculator": None,                        "layout": "cover",               "supports_modes":["percent"], "default_agg":"district", "needs_data": False},
    "tsi_status_trends":       {"calculator": calculate_tsi_status_trends, "layout":"tsi_stacked_column",   "supports_modes":["count","percent"], "default_agg":"district"},
    "tsi_status":              {"calculator": calculate_tsi_status,        "layout":"tsi_stacked_column",   "supports_modes":["count","percent"], "default_agg":"campus"},
    "tsi_leaderboard":         {"calculator": calculate_tsi_leaderboard,   "layout":"tsi_leaderboard",      "supports_modes":["count","percent"], "default_agg":"campus"},
    "ccmr_yoy_breakdown":      {"calculator": calculate_ccmr_yoy_breakdown,"layout":"ccmr_grouped_column",  "supports_modes":["count","percent"], "default_agg":"district"},
    "ccmr_af_status":          {"calculator": _calc_ccmr_af,               "layout":"ccmr_af_status",       "supports_modes":["count","percent"], "default_agg":"district"},
    "ccmr_pathway":            {"calculator": _calc_ccmr_pathway,          "layout":"ccmr_pathway",         "supports_modes":["count","percent"], "default_agg":"campus"},
    "postsecondary_enrollment":{"calculator": calculate_postsecondary_enrollment,"layout":"postsecondary_stacked","supports_modes":["count","percent"],"default_agg":"campus"},
    "ccmr_pathway_full":       {"calculator": calculate_ccmr_pathway_full,      "layout":"ccmr_pathway_full",     "supports_modes":["percent"],         "default_agg":"district"},
    "district_profile":        {"calculator": calculate_district_profile,        "layout":"district_profile",       "supports_modes":["percent"],         "default_agg":"district"},
    "by_the_numbers":          {"calculator": calculate_by_the_numbers,         "layout":"by_the_numbers",   "supports_modes":["count"],    "default_agg":"district"},
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
        "postsecondary_enrollment": "Postsecondary college enrollment by school (4YR, 2YR, Not Enrolled)",
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
        f"Line 3 = one actionable next step (start with ▶).\n"
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

    title_defaults = {'cover': 'Cover Slide', 'tsi_status_trends': 'TSI Status Trends', 'tsi_status': 'TSI Status by Campus', 'tsi_leaderboard': 'College Readiness: TSI Leaderboard', 'ccmr_yoy_breakdown': 'CCMR YOY Growth', 'ccmr_af_status': 'CCMR A-F Accountability Status', 'ccmr_pathway': 'CCMR Pathway Analysis', 'postsecondary_enrollment': 'Postsecondary Enrollment'}
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
        CATEGORY_ORDER = {
            "cover":["Cover & Section"],"mission":["Cover & Section"],"agenda":["Cover & Section"],
            "tsi_status_trends":["TSI"],"tsi_status":["TSI"],"tsi_leaderboard":["TSI"],
            "ccmr_yoy_breakdown":["CCMR"],"ccmr_af_status":["CCMR"],"ccmr_pathway":["CCMR"],"ccmr_pathway_full":["CCMR"],
            "district_profile":["District Profile"],
            "postsecondary_enrollment":["Postsecondary"],
            "hb3_funds":["HB3 Funding"],
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
            "postsecondary_enrollment":"Postsecondary Enrollment",
            "hb3_funds":               "HB3 Outcomes Bonus Funding",
            "by_the_numbers":          "By the Numbers",
            "outro":                   "Closing",
        }
        agenda_list = [{"name": CLEAN_NAMES.get(sc["slide_type"], sc["slide_type"].replace("_"," ").title()),
                        "category": CATEGORY_ORDER.get(sc["slide_type"],["Other"])[0], "icon":"📊"}
                       for sc in slides_config
                       if sc["slide_type"] not in ("cover","agenda","methodology","section_divider","mission","outro")]

        cover_idx = next((i for i,sc in enumerate(slides_config) if sc["slide_type"]=="cover"), -1)
        if agenda_list and not any(sc["slide_type"]=="agenda" for sc in slides_config):
            agenda_sc = {"slide_type":"agenda","slide_data":{"District":"","Title":"Agenda","slides_list":agenda_list},"chart_data":{},"mode":"percent","layout":"agenda","insights":[],"month":"","year_label":"","footnote":""}
            insert_at = cover_idx+1 if cover_idx>=0 else 0
            slides_config.insert(insert_at, agenda_sc)

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
