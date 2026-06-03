"""
Rule-based data insights — no API key required.
Generates specific, data-driven insight bullets from chart data.
"""


def _pp(val):
    """Format a percentage point value with sign."""
    return f"+{val:.1f}pp" if val >= 0 else f"{val:.1f}pp"


def _pct(val):
    return f"{val:.1f}%"


def compute_insights(slide_type: str, chart_data: dict, slide_data: dict, mode: str) -> list:
    """
    Compute 3 specific insight bullets from the chart data.
    Returns a list of strings (plain text, no bullet prefix).
    """
    cats   = chart_data.get("categories", [])
    series = chart_data.get("series", [])
    district = slide_data.get("District", "the district")

    if not cats or not series:
        return []

    try:
        if slide_type in ("tsi_status_trends", "tsi_status"):
            return _tsi_trends_insights(cats, series, mode, district)
        elif slide_type == "tsi_leaderboard":
            return _tsi_leaderboard_insights(cats, series, mode, district)
        elif slide_type == "ccmr_yoy_breakdown":
            return _ccmr_yoy_insights(cats, series, mode, district)
        elif slide_type == "ccmr_af_status":
            return _ccmr_af_insights(cats, series, mode, district)
        elif slide_type == "ccmr_pathway":
            return _ccmr_pathway_insights(cats, series, mode, district)
        elif slide_type == "postsecondary_enrollment":
            return _postsecondary_insights(cats, series, mode, district)
        elif slide_type == "ccmr_pathway_full":
            return _pathway_full_insights(cats, series, mode, district)
        elif slide_type in ("district_profile",):
            return _district_profile_insights(cats, series, mode, district)
        elif slide_type == "hb3_funds":
            return _hb3_insights(cats, series, mode, district)
        elif slide_type == "by_the_numbers":
            return _by_the_numbers_insights(cats, series, mode, district, slide_data)
        else:
            return []
    except Exception as e:
        print(f"Insights error for {slide_type}: {e}")
        return []


# ── TSI Trends / Status ───────────────────────────────────────────────────────

def _tsi_trends_insights(cats, series, mode, district):
    insights = []
    unit = "%" if mode == "percent" else " students"

    # Use actual series names from data (respects user edits)
    def find_by_index(idx):
        if idx < len(series): return series[idx]["values"]
        return None

    def find(keyword):
        """Find series by keyword — falls back to index if keyword not matched."""
        for s in series:
            if keyword.lower() in s["name"].lower():
                return s["values"], s["name"]
        return None, None

    assessment, assessment_name = find("assessment")
    if not assessment:
        assessment = find_by_index(0)
        assessment_name = series[0]["name"] if series else "Series 1"
    cp, cp_name         = find("cp") or (find_by_index(1), series[1]["name"] if len(series)>1 else "Series 2")
    not_met, notmet_name= find("not met") or (find_by_index(2), series[2]["name"] if len(series)>2 else "Series 3")

    # 1. Trend for "Met by Assessment"
    if assessment and len(assessment) >= 2:
        first, last = assessment[0], assessment[-1]
        change = last - first
        years  = f"{cats[0]} to {cats[-1]}"
        direction = "increased" if change >= 0 else "decreased"
        insights.append(
            f"{assessment_name} {direction} from {_pct(first)} to {_pct(last)} "
            f"({_pp(change)}) from {years}."
        )

    # 2. TSI Not Met trend
    if not_met and len(not_met) >= 2:
        first, last = not_met[0], not_met[-1]
        change = last - first
        direction = "decreased" if change <= 0 else "increased"
        if abs(change) >= 0.5:
            insights.append(
                f"{notmet_name or 'TSI Not Met'} {direction} by {abs(change):.1f}pp "
                f"from {cats[0]} to {cats[-1]} — "
                f"{'a positive sign of improvement' if change <= 0 else 'an area requiring attention'}."
            )

    # 3. Best year
    if assessment:
        best_idx = assessment.index(max(assessment))
        insights.append(
            f"Highest {assessment_name or 'TSI Met'} rate: {_pct(assessment[best_idx])} in {cats[best_idx]}."
        )

    # Actionable next step based on trend
    if assessment and len(assessment) >= 2:
        latest = assessment[-1]
        change = assessment[-1] - assessment[-2]
        if latest < 25:
            insights.append(
                f"Prioritize students in 'Approaches' status for intensive TSI test prep — "
                f"these students are closest to meeting the standard and can shift with targeted support."
            )
        elif change > 0:
            insights.append(
                f"Sustain momentum by replicating successful TSI support strategies across all campuses "
                f"and scheduling early testing for the next cohort."
            )
        else:
            insights.append(
                f"Review campus-level TSI intervention plans — identify what changed between {cats[-2]} "
                f"and {cats[-1]} and adjust student support strategies before the next testing cycle."
            )

    return insights[:3]


# ── TSI Leaderboard ───────────────────────────────────────────────────────────

def _tsi_leaderboard_insights(cats, series, mode, district):
    vals = series[0]["values"] if series else []
    if not vals: return []

    avg       = sum(vals) / len(vals)
    top       = max(vals)
    top_name  = cats[vals.index(top)]
    n         = len(vals)
    on_track  = sum(1 for v in vals if v >= avg)
    off_track = n - on_track

    below = [cats[i] for i, v in enumerate(vals) if v < avg]

    return [
        f"{on_track} of {n} campuses are at or above the district average of {_pct(avg)}. "
        f"{off_track} campus{'es are' if off_track!=1 else ' is'} below average and need targeted TSI support.",
        f"{top_name} leads with {_pct(top)} TSI met rate — {top-avg:.1f}pp above the group average.",
        f"Schedule coaching visits for {', '.join(below[:2])}"
        f"{(' and ' + str(len(below)-2) + ' others') if len(below)>2 else ''} — "
        f"targeted TSI test prep resources would move the most students.",
    ][:3]


# ── CCMR YOY Breakdown ────────────────────────────────────────────────────────

def _ccmr_yoy_insights(cats, series, mode, district):
    """cats = ['TSI','IBC','Enrollment'], series = [{name:'2023',values:[...]}, ...]"""
    insights = []
    if len(series) < 2:
        return []

    first_yr = series[0]
    last_yr  = series[-1]
    yr1, yr2 = first_yr["name"], last_yr["name"]

    cat_map = {c.lower(): i for i, c in enumerate(cats)}
    tsi_i   = cat_map.get("tsi",        0)
    ibc_i   = cat_map.get("ibc",        1)
    enr_i   = cat_map.get("enrollment", 2)

    def safe(ser, idx):
        v = ser["values"]
        return float(v[idx]) if idx < len(v) else 0.0

    tsi_change = safe(last_yr, tsi_i)  - safe(first_yr, tsi_i)
    ibc_change = safe(last_yr, ibc_i)  - safe(first_yr, ibc_i)
    enr_change = safe(last_yr, enr_i)  - safe(first_yr, enr_i)

    insights.append(
        f"TSI CCMR rate grew {_pp(tsi_change)} from {yr1} to {yr2} "
        f"({_pct(safe(first_yr, tsi_i))} → {_pct(safe(last_yr, tsi_i))})."
    )

    if safe(last_yr, ibc_i) > 0:
        insights.append(
            f"IBC/Certification completion {_pp(ibc_change)} over the same period "
            f"({_pct(safe(first_yr, ibc_i))} → {_pct(safe(last_yr, ibc_i))})."
        )
    else:
        insights.append("IBC/Certification data not available for this period.")

    if safe(last_yr, enr_i) > 0:
        insights.append(
            f"Postsecondary Enrollment rate reached {_pct(safe(last_yr, enr_i))} in {yr2} "
            f"({_pp(enr_change)} from {yr1})."
        )
    # Actionable next step based on weakest indicator
    vals_latest = [safe(last_yr, tsi_i), safe(last_yr, ibc_i), safe(last_yr, enr_i)]
    names_latest = ["TSI", "IBC/Certification", "Postsecondary Enrollment"]
    weakest_i = vals_latest.index(min(v for v in vals_latest if v > 0)) if any(v > 0 for v in vals_latest) else 0
    insights.append(
        f"Focus next quarter on {names_latest[weakest_i]} — "
        f"currently the lowest indicator at {_pct(vals_latest[weakest_i])}. "
        f"Review which students are closest to meeting this qualifier and prioritize outreach."
    )

    return insights[:3]


# ── CCMR A-F Status ───────────────────────────────────────────────────────────

def _ccmr_af_insights(cats, series, mode, district):
    vals  = series[0]["values"] if series else [0, 0, 0]
    total = sum(vals) or 1
    met   = vals[0] if len(vals) > 0 else 0
    app   = vals[1] if len(vals) > 1 else 0
    notm  = vals[2] if len(vals) > 2 else 0
    goal  = 90.0
    met_pct  = met  / total * 100
    notm_pct = notm / total * 100
    gap   = goal - met_pct
    needed = max(0, round(gap / 100 * total))

    insights = []
    insights.append(
        f"{_pct(met_pct)} of students ({int(met)}) have met CCMR — "
        f"{gap:.1f}pp below the {goal:.0f}% district goal."
    )
    insights.append(
        f"{int(notm)} students ({_pct(notm_pct)}) have not met CCMR — "
        f"{'immediate intervention needed' if notm_pct > 50 else 'targeted support recommended'}."
    )
    if needed > 0:
        insights.append(
            f"To reach {goal:.0f}%: identify the {needed} students closest to CCMR via 'Approaches' status, "
            f"enroll them in TSI prep or Dual Credit before the next reporting cycle."
        )
    return insights[:3]


# ── CCMR Pathway Analysis ─────────────────────────────────────────────────────

def _ccmr_pathway_insights(cats, series, mode, district):
    vals  = series[0]["values"] if series else []
    total = sum(vals[:2]) if len(vals) >= 2 else 1
    on_p  = vals[0] if len(vals) > 0 else 0
    off_p = vals[1] if len(vals) > 1 else 0

    on_pct  = on_p  / total * 100 if total else 0
    off_pct = off_p / total * 100 if total else 0

    # Find dominant pathway (index 2+)
    path_names = cats[2:] if len(cats) > 2 else []
    path_vals  = vals[2:] if len(vals) > 2 else []
    dominant   = ""
    if path_names and path_vals:
        best_i   = path_vals.index(max(path_vals))
        dominant = path_names[best_i]
        dom_pct  = path_vals[best_i] / total * 100 if total else 0

    insights = []
    insights.append(
        f"{int(on_p)} students ({_pct(on_pct)}) are on a CCMR pathway — "
        f"{int(off_p)} ({_pct(off_pct)}) have no pathway and need immediate outreach."
    )
    if dominant:
        insights.append(
            f"{dominant} is the most common pathway with "
            f"{int(max(path_vals))} students ({_pct(dom_pct)} of enrollment)."
        )
    if off_pct > 30:
        insights.append(
            f"With {_pct(off_pct)} of students off-track, expand pathway access — "
            f"focus on Dual Credit and TSI enrollment opportunities."
        )
    elif off_pct > 10:
        insights.append(
            f"Targeted intervention for the {int(off_p)} off-pathway students could "
            f"significantly improve CCMR outcomes."
        )
    return insights[:3]


# ── Postsecondary Enrollment ──────────────────────────────────────────────────

def _postsecondary_insights(cats, series, mode, district):
    def find(keyword):
        for s in series:
            if keyword.lower() in s["name"].lower():
                return s["values"]
        return None

    four_yr = find("4-year") or find("4yr") or []
    two_yr  = find("2-year") or find("2yr") or []
    not_enr = find("not enrolled") or []

    insights = []

    if four_yr and cats:
        avg_4yr = sum(four_yr) / len(four_yr)
        best_i  = four_yr.index(max(four_yr))
        worst_i = four_yr.index(min(four_yr))
        insights.append(
            f"Average 4-year college enrollment: {_pct(avg_4yr)}. "
            f"{cats[best_i]} leads at {_pct(four_yr[best_i])}."
        )

    if four_yr and two_yr and len(four_yr) == len(two_yr):
        combined = [f + t for f, t in zip(four_yr, two_yr)]
        avg_comb = sum(combined) / len(combined)
        insights.append(
            f"Combined college enrollment (2+4 year) averages {_pct(avg_comb)} across {len(cats)} schools."
        )

    if not_enr and cats:
        avg_not = sum(not_enr) / len(not_enr)
        highest_not_i = not_enr.index(max(not_enr))
        insights.append(
            f"Prioritize outreach at {cats[highest_not_i]} ({_pct(not_enr[highest_not_i])} not enrolled) — "
            f"connect students with FAFSA support, college advisors, and community college options "
            f"before the next enrollment deadline."
        )

    return insights[:3]


# ── CCMR Pathway Full Insights ────────────────────────────────────────────────

def _pathway_full_insights(cats, series, mode, district):
    vals = series[0]["values"] if series else []
    if not vals or not cats:
        return []
    top_idx  = vals.index(max(vals))
    last_idx = vals.index(min(v for v in vals if v >= 0))

    insights = [
        f"{cats[top_idx]} is the leading CCMR qualifier at {_pct(vals[top_idx])} of students — "
        f"this is the strongest pathway to protect and expand.",
        f"The bottom 3 qualifiers ({', '.join(cats[-3:])}) each reach fewer than {_pct(sorted(vals)[2])} of students — "
        f"significant room to grow.",
    ]
    above_30 = sum(1 for v in vals if v >= 30)
    insights.append(
        f"Focus recruitment on the {len(vals)-above_30} pathways below 30% participation "
        f"— especially Dual Credit and AP/IB which have broad scalability."
    )
    return insights[:3]


# ── District Profile Insights ─────────────────────────────────────────────────

def _district_profile_insights(cats, series, mode, district):
    insights = []
    years = cats  # e.g. ['2023','2024','2025']
    for s in series[:2]:  # focus on first 2 metrics
        vals = s["values"]
        if len(vals) >= 2:
            change = vals[-1] - vals[0]
            direction = "increased" if change >= 0 else "decreased"
            insights.append(
                f"{s['name']} {direction} by {abs(change):.1f}pp "
                f"({_pct(vals[0])} in {years[0]} → {_pct(vals[-1])} in {years[-1]})."
            )
    if len(series) >= 3:
        weakest = min(series, key=lambda s: s["values"][-1] if s["values"] else 0)
        insights.append(
            f"Prioritize improving {weakest['name']} — "
            f"currently the lowest metric at {_pct(weakest['values'][-1])}."
        )
    return insights[:3]


# ── HB3 Funds Insights ────────────────────────────────────────────────────────

def _hb3_insights(cats, series, mode, district):
    vals = series[0]["values"] if series else []
    if not vals or not cats:
        return []

    def fmt_m(v):
        if v >= 1: return f"${v:.1f}M"
        return f"${v*1000:.0f}K"

    total = sum(vals)
    if len(vals) >= 2:
        change = vals[-1] - vals[-2]
        trend_desc = f"up {abs(change):.2f}M" if change >= 0 else f"down {abs(change):.2f}M"
    else:
        trend_desc = "stable"

    insights = [
        f"Total estimated HB3 Outcomes Bonus across {len(cats)} class years: {fmt_m(total)}.",
        f"Most recent class ({cats[-1]}) projects {fmt_m(vals[-1])} — {trend_desc} from the prior year.",
        f"To increase HB3 funding, focus on students in 'Approaches' TSI status — "
        f"each additional OB-met student generates $3,000–$5,000 depending on economic status."
    ]
    return insights[:3]


# ── By the Numbers Insights ───────────────────────────────────────────────────

def _by_the_numbers_insights(cats, series, mode, district, slide_data):
    vals  = series[0]["values"] if series else []
    total = vals[0] if len(vals) > 0 else 0
    tsi   = vals[1] if len(vals) > 1 else 0
    hb3   = vals[2] if len(vals) > 2 else 0
    tsi_pct = round(tsi / total * 100, 1) if total else 0
    cohort  = slide_data.get("Cohort","")

    insights = []
    if total and tsi:
        insights.append(
            f"{tsi} of {total} students ({_pct(tsi_pct)}) in {cohort} met TSI — "
            f"{'strong performance above district average' if tsi_pct >= 50 else 'targeted intervention needed to reach TSI goals'}."
        )
    if hb3 > 0:
        def fmt(v):
            if v >= 1_000_000: return f"${v/1_000_000:.1f}M"
            if v >= 1_000:     return f"${v/1_000:.0f}K"
            return f"${v:.0f}"
        insights.append(
            f"Estimated HB3 Outcomes Bonus for {cohort}: {fmt(hb3)} — "
            f"funding released 2 years after graduation."
        )
    insights.append(
        f"To increase TSI met rate and HB3 funding, prioritize students in 'Approaches' status "
        f"for targeted test preparation before the next testing window."
    )
    return insights[:3]
