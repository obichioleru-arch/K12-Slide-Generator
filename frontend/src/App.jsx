import { useEffect, useState, useRef } from "react";
import axios from "axios";
import "./App.css";
import emcLandingLogo from "./assets/emc_landing_logo.png";

// Use local FastAPI backend while running Vite locally; keep Render for deployed builds.
const API = (import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "http://127.0.0.1:8000" : "https://k12-slide-generator-api.onrender.com")
).replace(/\/$/, "");
const COLORS = ["#003291","#00B0F0","#E8192C","#FFC000","#C084FC","#6B7280"];
const MANUAL = "__manual__";

// ── Mini chart preview ────────────────────────────────────────────────────────


function getSeriesColor(name, idx = 0){
  const n = String(name || "").toLowerCase();
  if(n.includes("not met")) return "#D97706";
  if(n.includes("tsi met") || n.trim() === "met" || n.includes(" met")) return "#003291";
  const palette = ["#003291", "#6B7280", "#D97706", "#F9A825", "#7C3AED"];
  return palette[idx % palette.length];
}


function campusLabel(name){
  let s = String(name || "").trim();
  const replacements = [
    ["High School", "HS"],
    ["Accelerated", "Accel."],
    ["Academy", "Acad."],
    ["Collegiate Institute", "Collegiate Inst."],
    ["Career High", "Career"],
    ["Young Women's Leadership Academy", "YWLA"],
    ["at Bill Arnold", "Bill Arnold"],
  ];
  replacements.forEach(([oldValue,newValue]) => { s = s.replaceAll(oldValue,newValue); });
  return s;
}

function cleanSourceText(text){
  let s = String(text || "").trim();
  s = s.replace(/^(Source:\s*[^.]+\.?\s*)+(?=Source:\s*)/i, "");
  s = s.replace(/^Source:\s*District Salesforce\.\s*(?=Source:\s*)/i, "");
  return s.trim();
}

function shouldUseHorizontalStackedPreview(chartData){
  const names = (chartData?.series || []).map(s => String(s?.name || "").toLowerCase());
  return names.length === 2 && names.some(n => n.includes("not met")) && names.some(n => n.includes("met"));
}

function isCcmrYoyCards(chartData){
  const cats = (chartData?.categories || []).map(c => String(c).toLowerCase());
  const hasMetrics = ["tsi","ibc","enrollment"].every(m => cats.some(c => c.includes(m)));
  return hasMetrics && (chartData?.series || []).length >= 2;
}

function isCcmrAfAccountabilityPreview(chartData){
  const cats = (chartData?.categories || []).map(c => String(c).toLowerCase());
  return cats.includes("met") && cats.some(c => c.includes("approach")) && cats.some(c => c.includes("not met"));
}

function CcmrAfAccountabilityPreview({ chartData }){
  const categories = chartData?.categories || ["Met","Approaches","Not Met"];
  const vals = chartData?.series?.[0]?.values || [0,0,0];
  const total = Number(chartData?.total_students) || vals.reduce((a,b)=>a+(Number(b)||0),0) || 1;
  const pctFromData = chartData?.status_percentages || vals.map(v => total ? (Number(v)||0)/total*100 : 0);
  const idxFor = label => categories.findIndex(c => String(c).toLowerCase().includes(label));
  const metIdx = idxFor("met") >= 0 ? idxFor("met") : 0;
  const appIdx = idxFor("approach") >= 0 ? idxFor("approach") : 1;
  const notIdx = categories.findIndex(c => String(c).toLowerCase().includes("not met"));
  const finalNotIdx = notIdx >= 0 ? notIdx : 2;
  const data = [
    {label:"Met", count:Number(vals[metIdx])||0, pct:Number(pctFromData[metIdx])||0, color:"#16A34A", bg:"#ECFDF5"},
    {label:"Approaches", count:Number(vals[appIdx])||0, pct:Number(pctFromData[appIdx])||0, color:"#D97706", bg:"#FFFBEB"},
    {label:"Not Met", count:Number(vals[finalNotIdx])||0, pct:Number(pctFromData[finalNotIdx])||0, color:"#E11D48", bg:"#FFF1F2"},
  ];
  const goal = Number(chartData?.goal_pct) || 90;
  const metPct = data[0].pct;
  const gap = Number(chartData?.gap_pts ?? Math.max(0, goal-metPct)).toFixed(1);
  const needed = Number(chartData?.additional_needed || 0);

  return(
    <div style={{width:"100%",maxWidth:780,margin:"0 auto",fontFamily:"Arial, sans-serif",color:"#1F2933"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:14}}>
        {data.map(d=>(
          <div key={d.label} style={{border:`2px solid ${d.color}`,background:d.bg,borderRadius:8,padding:"12px 10px",textAlign:"center"}}>
            <div style={{fontSize:12,fontWeight:900,letterSpacing:".08em",textTransform:"uppercase",color:d.color}}>{d.label}</div>
            <div style={{fontSize:28,fontWeight:900,color:d.color,lineHeight:1.1,marginTop:6}}>{Math.round(d.count).toLocaleString()}</div>
            <div style={{fontSize:13,fontWeight:800,color:d.color}}>{d.pct.toFixed(1)}%</div>
          </div>
        ))}
      </div>

      <div style={{fontWeight:900,color:"#003291",margin:"6px 0 6px",fontSize:14}}>Progress Toward 90% Goal</div>
      <div style={{height:26,display:"flex",borderRadius:4,overflow:"hidden",background:"#E5E7EB",position:"relative",marginBottom:10}}>
        {data.map(d=><div key={d.label} style={{width:`${Math.max(0,d.pct)}%`,background:d.color,color:"#fff",fontSize:10,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>{d.label} {d.pct.toFixed(1)}%</div>)}
        <div style={{position:"absolute",left:`${goal}%`,top:0,bottom:0,width:2,background:"#003291"}}/>
      </div>
      <div style={{textAlign:"right",fontSize:10,fontWeight:900,color:"#003291",marginTop:-8}}>GOAL</div>

      <div style={{background:"#F3F4F6",borderRadius:8,padding:12,display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
        <div><div style={{fontSize:10,fontWeight:800,color:"#374151"}}>Currently Met</div><div style={{fontSize:20,fontWeight:900,color:"#16A34A"}}>{Math.round(data[0].count).toLocaleString()}</div></div>
        <div><div style={{fontSize:10,fontWeight:800,color:"#374151"}}>Additional Needed</div><div style={{fontSize:20,fontWeight:900,color:"#E11D48"}}>+{needed.toLocaleString()}</div></div>
        <div><div style={{fontSize:10,fontWeight:800,color:"#374151"}}>Gap to Goal</div><div style={{fontSize:20,fontWeight:900,color:"#003291"}}>{gap} pts</div></div>
      </div>
    </div>
  );
}





const CCMR_AF_STATUS_SLIDE_IDS = new Set([
  "ccmr_af_status",
  "ccmr_accountability",
  "ccmr_accountability_status",
  "ccmr_a_f_status",
  "ccmr_af_accountability",
  "ccmr_status"
]);

function isCcmrAfStatusSlide(slideType){
  return CCMR_AF_STATUS_SLIDE_IDS.has(String(slideType || ""));
}

const CCMR_AF_ONLY_REQUIRED_COLUMNS = [
  {
    key: "ccmr_overall",
    label: "CCMR Overall",
    column: "CCMR Overall",
    description: "Overall CCMR accountability status. This represents CCMR A-F Status. Values: Met, Approaches, Not Met.",
    required: true,
    candidates: ["CCMR Overall", "CCMR Overall Status", "CCMR A-F Overall", "CCMR A-F Status", "CCMR Status", "CCMR"]
  }
];

function getDisplayedRequiredColumns(slideType, rows){
  if(isCcmrAfStatusSlide(slideType)){
    return CCMR_AF_ONLY_REQUIRED_COLUMNS;
  }
  return rows;
}


const CCMR_PATHWAY_REQUIRED_COLUMNS = [
  {
    key: "ccmr_status",
    label: "CCMR A-F / CCMR Status",
    column: "CCMR Overall Status",
    description: "Overall CCMR A-F status. Values: Met, Approaches, Not Met.",
    required: true,
    candidates: ["CCMR Overall Status", "CCMR Overall", "CCMR A-F Status", "CCMR A-F Overall", "CCMR Status", "CCMR"]
  },
  {
    key: "dual_credit",
    label: "Dual Credit",
    column: "Dual Credit",
    description: "Dual Credit CCMR qualifier. Values: Met, Not Met.",
    required: true,
    candidates: ["CCMR Dual Credit Status", "Dual Credit Status", "Dual Credit", "CCMR Dual Credit", "Dual Credit Met"]
  },
  {
    key: "tsi",
    label: "CCMR TSI / TSI",
    column: "CCMR TSI Status",
    description: "CCMR TSI qualifier. Values: Met, Approaches, Not Met.",
    required: true,
    candidates: ["CCMR TSI Status", "CCMR TSI", "TSI Status", "TSI", "College Ready", "TSI Met"]
  },
  {
    key: "ap_ib",
    label: "AP/IB",
    column: "AP/IB",
    description: "AP/IB CCMR qualifier. Values: Met, Not Met.",
    required: true,
    candidates: ["CCMR AP/IB Status", "AP/IB Status", "AP IB Status", "AP/IB", "AP Status", "IB Status"]
  },
  {
    key: "ibc",
    label: "IBC",
    column: "IBC",
    description: "Industry-Based Certification CCMR qualifier. Values: Met, Not Met.",
    required: true,
    candidates: ["CCMR Certification Status", "CCMR IBC Status", "IBC Status", "IBC", "Industry Based Certification", "Industry-Based Certification", "Certification/IBC", "Certification"]
  }
];

function normalizeCcmrPathwayFields(slideType, fields){
  if(String(slideType || "") === "ccmr_pathway"){
    return CCMR_PATHWAY_REQUIRED_COLUMNS;
  }
  return fields;
}

function normalizeRequiredColumnsForSlide(slideType, columns){
  if(isCcmrAfStatusSlide(slideType)){
    return CCMR_AF_ONLY_REQUIRED_COLUMNS;
  }
  return columns;
}



function CcmrPathwayPreview({chartData = {}, slideData = {}}) {
  const total = Number(chartData?.total_students || slideData?.total_students || 0);
  const onPathway = Number(chartData?.on_pathway || slideData?.on_pathway || 0);
  const onPct = Number(chartData?.on_pathway_pct || slideData?.on_pathway_pct || 0);
  const offPathway = Number(chartData?.not_on_pathway || slideData?.not_on_pathway || 0);
  const offPct = Number(chartData?.not_on_pathway_pct || slideData?.not_on_pathway_pct || 0);
  const counts = chartData?.counts || [];
  const pcts = chartData?.percentages || [];
  const cards = [
    ["DUAL CREDIT", counts[0] || 0, pcts[0] || 0, "#00B0F0"],
    ["TSI", counts[1] || 0, pcts[1] || 0, "#7C3AED"],
    ["AP/IB", counts[2] || 0, pcts[2] || 0, "#10B981"],
    ["IBC", counts[3] || 0, pcts[3] || 0, "#F59E0B"],
  ];
  const top = cards.reduce((best, item) => Number(item[2]) > Number(best[2]) ? item : best, cards[0]);

  return (
    <div style={{width:"100%", maxWidth:1120, margin:"0 auto", fontFamily:"Arial, sans-serif", color:"#1F2937"}}>
      <div style={{display:"flex", gap:14, alignItems:"stretch"}}>
        <div style={{width:210, minHeight:300, background:"#E8192C", color:"white", borderRadius:10, textAlign:"center", padding:"22px 18px", boxSizing:"border-box", position:"relative"}}>
          <div style={{width:42,height:42,borderRadius:"50%",background:"rgba(255,255,255,.25)",margin:"0 auto 24px",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:22}}>!</div>
          <div style={{fontSize:42, fontWeight:900, lineHeight:.95}}>{offPathway.toLocaleString()}</div>
          <div style={{fontSize:15, fontWeight:900, marginTop:10}}>Students</div>
          <div style={{fontSize:15, fontWeight:900, lineHeight:1.35, marginTop:8}}>NOT ON ANY<br/>CCMR PATHWAY</div>
          <div style={{position:"absolute", left:20, right:20, bottom:45, background:"rgba(255,255,255,.22)", borderRadius:18, padding:"7px 4px", fontSize:11, fontWeight:900, whiteSpace:"nowrap"}}>{offPct.toFixed(1)}% of all students</div>
        </div>

        <div style={{flex:1}}>
          <div style={{background:"#003291", color:"white", borderRadius:7, padding:"15px 18px", marginBottom:12}}>
            <div style={{color:"#BFD7FF", fontWeight:900, fontSize:15}}>STUDENTS ON A CCMR PATHWAY</div>
            <div style={{fontWeight:900, fontSize:15, marginTop:8}}>
              {onPathway.toLocaleString()} students are on pathway toward CCMR
              <span style={{color:"#00B0F0", marginLeft:14}}>{onPct.toFixed(1)}% of enrollment</span>
            </div>
          </div>

          <div style={{display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8}}>
            {cards.map(([label,count,pct,color]) => (
              <div key={label} style={{background:"#F3F4F6", borderRadius:7, borderTop:`3px solid ${color}`, textAlign:"center", padding:"15px 8px"}}>
                <div style={{color, fontWeight:900, letterSpacing:1.1, fontSize:13}}>{label}</div>
                <div style={{fontWeight:900, fontSize:25, color:"#111827", marginTop:6}}>{Number(count).toLocaleString()}</div>
                <div style={{color, fontWeight:900, fontSize:14, marginTop:5}}>{Number(pct).toFixed(1)}%</div>
                <div style={{fontSize:10, color:"#4B5563"}}>students</div>
              </div>
            ))}
          </div>

          <div style={{background:"#003291", color:"white", borderRadius:7, padding:"14px 16px", marginTop:12}}>
            <div style={{color:"#00B0F0", fontWeight:900, letterSpacing:1.2, marginBottom:8}}>ACTION INSIGHTS</div>
            <div style={{fontSize:13, lineHeight:1.35}}>▶ {onPathway.toLocaleString()} students ({onPct.toFixed(1)}%) are on a CCMR pathway — {offPathway.toLocaleString()} ({offPct.toFixed(1)}%) have no pathway and need immediate outreach.</div>
            <div style={{fontSize:13, lineHeight:1.35, marginTop:5}}>▶ {top[0]} is the most common pathway with {Number(top[1]).toLocaleString()} students ({Number(top[2]).toFixed(1)}% of enrollment).</div>
          </div>
        </div>
      </div>
    </div>
  );
}




function DistrictProfilePreview({ chartData = {} }){
  const categories = chartData?.categories || [];
  const series = chartData?.series || [];
  const colors = ["#93C5FD", "#1D4ED8", "#003291", "#00B0F0"];
  const metricScale = () => 100;
  return(
    <div style={{width:"100%",maxWidth:980,margin:"0 auto",fontFamily:"Arial, sans-serif",color:"#1F2933"}}>
      <div style={{display:"flex",gap:16,margin:"0 0 10px 4px",flexWrap:"wrap"}}>
        {categories.map((cat,ci)=>(
          <div key={cat} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,fontWeight:800}}>
            <span style={{width:12,height:12,borderRadius:3,background:colors[ci%colors.length],display:"inline-block"}} />{cat}
          </div>
        ))}
      </div>
      <div style={{display:"flex",border:"2px solid #9CA3AF",borderRadius:8,overflow:"hidden",background:"#fff",height:360}}>
        {series.map((metric,mi)=>{
          const available = metric.available ?? (metric.values || []).some(v => v !== null && v !== undefined);
          return(
            <div key={metric.name || mi} style={{flex:1,borderRight:mi<series.length-1?"2px solid #9CA3AF":"none",padding:"10px 6px 6px",display:"flex",flexDirection:"column",alignItems:"center",minWidth:0}}>
              <div style={{fontSize:12,fontWeight:900,color:"#003291",textAlign:"center",lineHeight:1.15,minHeight:32,display:"flex",alignItems:"center"}}>{metric.name}</div>
              {!available ? (
                <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",color:"#9CA3AF",fontWeight:900}}>
                  <div style={{fontSize:24}}>N/A</div>
                  <div style={{fontSize:10,color:"#6B7280"}}>Column not available</div>
                </div>
              ) : (
                <svg viewBox="0 0 190 280" style={{width:"100%",flex:1,overflow:"visible"}}>
                  <line x1="12" y1="232" x2="178" y2="232" stroke="#9CA3AF" strokeWidth="2.5" />
                  {categories.map((cat,ci)=>{
                    const localMax = metricScale(metric.values || []);
                    const raw = metric.values?.[ci];
                    const val = raw === null || raw === undefined ? null : Number(raw);
                    const x = 30 + ci * (130 / Math.max(1, categories.length-1 || 1));
                    if(!Number.isFinite(val)){
                      return <g key={cat}><text x={x} y="205" textAnchor="middle" fontSize="12" fontWeight="900" fill="#9CA3AF">N/A</text><text x={x} y="259" textAnchor="middle" fontSize="11.5" fontWeight="900" fill="#1F2933">{cat}</text></g>
                    }
                    const bh = Math.max(14, (Math.max(0,val)/localMax)*205);
                    const y = 232-bh;
                    const labelY = Math.max(18, y - 7);
                    return <g key={cat}><rect x={x-18} y={y} width="36" height={bh} rx="4" fill={colors[ci%colors.length]} /><text x={x} y={labelY} textAnchor="middle" fontSize="12" fontWeight="900" fill="#003291">{val.toFixed(1)}%</text><text x={x} y="259" textAnchor="middle" fontSize="11.5" fontWeight="900" fill="#1F2933">{cat}</text></g>
                  })}
                </svg>
              )}
            </div>
          )
        })}
      </div>
    </div>
  );
}

function PostsecondaryReadinessPreview({ chartData = {} }){
  const kpis = chartData?.kpis || [];
  const comparison = chartData?.comparison || [];
  const gaps = chartData?.opportunity_gaps || [];
  const metric = chartData?.comparison_metric || "Financial Aid Submitted";
  const colors = ["#0057B8", "#00A7D8", "#7C3AED", "#D99A00"];
  return(
    <div style={{width:"100%",maxWidth:980,margin:"0 auto",fontFamily:"Arial, sans-serif",color:"#07154A"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:10}}>
        {[0,1,2,3].map(i=>{const k=kpis[i]||{};const accent=k.accent||colors[i];const available=k.available&&k.pct!==null&&k.pct!==undefined;return(
          <div key={i} style={{background:"#fff",border:"1px solid #E5E7EB",borderLeft:`4px solid ${accent}`,borderRadius:8,padding:"10px 10px",boxShadow:"0 2px 7px rgba(15,23,42,.10)"}}>
            <div style={{fontSize:11,fontWeight:900,color:"#07154A",height:24}}>{k.label||"Metric"}</div>
            <div style={{fontSize:28,fontWeight:900,color:accent,lineHeight:1}}>{available?`${Number(k.pct).toFixed(1)}%`:"N/A"}</div>
            <div style={{fontSize:10,color:"#4B5563",marginTop:5}}>{available?`${Number(k.count||0).toLocaleString()} of ${Number(k.total||0).toLocaleString()} students`:"Column not available"}</div>
          </div>
        )})}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"2.05fr .95fr",gap:10}}>
        <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:8,padding:14,boxShadow:"0 2px 7px rgba(15,23,42,.10)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <div><div style={{fontSize:18,fontWeight:900}}>Campus Comparison</div><div style={{fontSize:11,color:"#6B7280"}}>% of students with {metric}</div></div>
            <div style={{fontSize:11,fontWeight:800,border:"1px solid #0057B8",borderRadius:16,padding:"5px 10px"}}>Metric: {metric} ▾</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {comparison.slice(0,6).map((r,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"22px 210px 1fr 48px",gap:8,alignItems:"center"}}>
                <div style={{width:18,height:18,borderRadius:"50%",background:"#0057B8",color:"#fff",fontSize:10,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>{i+1}</div>
                <div style={{fontSize:11,fontWeight:800,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{campusLabel(r.campus)}</div>
                <div style={{height:14,background:"#EEF2F7",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.max(0,Math.min(100,Number(r.pct)||0))}%`,background:"#07154A"}} /></div>
                <div style={{fontSize:11,fontWeight:900}}>{Number(r.pct||0).toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:8,padding:14,boxShadow:"0 2px 7px rgba(15,23,42,.10)"}}>
          <div style={{fontSize:18,fontWeight:900}}>Opportunity Gap</div>
          <div style={{fontSize:11,color:"#6B7280",marginBottom:10}}>Students not yet completed</div>
          {gaps.slice(0,3).map((g,i)=>{const accent=g.accent||colors[i];return(
            <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 70px",gap:8,alignItems:"center",background:"#F8FBFF",border:"1px solid #E5E7EB",borderRadius:8,padding:"10px 12px",marginBottom:8}}>
              <div><div style={{fontSize:12,fontWeight:900,color:accent}}>{g.missing_label}</div><div style={{fontSize:10,color:"#6B7280"}}>of {Number(g.total||0).toLocaleString()} students</div></div>
              <div style={{textAlign:"right",color:accent}}><div style={{fontSize:18,fontWeight:900,lineHeight:1}}>{Number(g.missing_count||0).toLocaleString()}</div><div style={{fontSize:12,fontWeight:900}}>{Number(g.missing_pct||0).toFixed(1)}%</div></div>
            </div>
          )})}
        </div>
      </div>
    </div>
  );
}


function Hb3FundsPreview({ chartData = {}, slideData = {} }){
  const categories = chartData?.categories || [];
  const values = chartData?.series?.[0]?.values || [];
  const hb3StatusFor = (cat) => {
    const yr = String(cat || "").match(/20\d{2}/)?.[0];
    if (yr === "2025") return "estimate";
    if (yr === "2026") return "projected";
    return "verified";
  };
  const statuses = categories.map(c => hb3StatusFor(c));
  const statusLabel = s => s === "estimate" ? "ESTIMATED" : s === "projected" ? "PROJECTED" : "VERIFIED";
  const statusColor = s => s === "projected" ? "#00B0F0" : s === "estimate" ? "#2563EB" : "#003291";
  const fmtMoney = v => {
    const n = Number(v)||0;
    if(Math.abs(n) >= 1000000) return `$${(n/1000000).toFixed(1)}M`;
    if(Math.abs(n) >= 1000) return `$${(n/1000).toFixed(1)}K`;
    if(Math.abs(n) >= 1) return `$${n.toFixed(1)}M`;
    if(n > 0) return `$${Math.round(n*1000)}K`;
    return "$0";
  };
  const maxV = Math.max(1, ...values.map(v=>Number(v)||0)) * 1.15;
  const W=760,H=360,pL=74,pR=18,pT=18,pB=58,cW=W-pL-pR,cH=H-pT-pB;
  return <div style={{width:"100%",maxWidth:980,margin:"0 auto",fontFamily:"Arial, sans-serif",color:"#1F2933"}}>
    <div style={{display:"grid",gridTemplateColumns:"1fr 220px",gap:16,alignItems:"start"}}>
      <div>
        <div style={{fontSize:14,fontWeight:900,color:"#6B7280",letterSpacing:".06em",marginBottom:6}}>HB3 FUNDS BY CLASS YEAR</div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",display:"block"}}>
          {[0,1,2,3,4].map(k=>{const t=maxV*k/4; const y=pT+cH-(t/maxV)*cH; return <g key={k}><line x1={pL} y1={y} x2={pL+cW} y2={y} stroke="#E5E7EB"/><text x={pL-8} y={y+4} textAnchor="end" fontSize="10" fill="#9CA3AF">{fmtMoney(t)}</text></g>})}
          <line x1={pL} y1={pT} x2={pL} y2={pT+cH} stroke="#D1D5DB"/><line x1={pL} y1={pT+cH} x2={pL+cW} y2={pT+cH} stroke="#D1D5DB"/>
          {categories.map((cat,i)=>{const val=Number(values[i])||0; const bh=(val/maxV)*cH; const gap=cW/Math.max(1,categories.length); const bw=Math.min(70,gap*.42); const cx=pL+gap*i+gap/2; const y=pT+cH-bh; const st=statuses[i]; return <g key={cat}><rect x={cx-bw/2} y={y} width={bw} height={Math.max(3,bh)} rx="4" fill={statusColor(st)}/>{bh>24?<text x={cx} y={y+bh/2+4} textAnchor="middle" fontSize="12" fontWeight="900" fill="#fff">{fmtMoney(val)}</text>:<text x={cx} y={y-6} textAnchor="middle" fontSize="11" fontWeight="900" fill="#003291">{fmtMoney(val)}</text>}<text x={cx} y={pT+cH+20} textAnchor="middle" fontSize="12" fontWeight="900" fill="#111827">{cat}</text><text x={cx} y={pT+cH+38} textAnchor="middle" fontSize="10" fontWeight="800" fill="#6B7280">{statusLabel(st)}</text></g>})}
        </svg>
      </div>
      <div>
        <div style={{background:"#003291",color:"white",borderRadius:10,padding:"14px 12px",textAlign:"center",marginBottom:10}}><div style={{fontSize:10,fontWeight:900,color:"#00B0F0",letterSpacing:".08em"}}>{categories.length}-YEAR HB3 FUNDS TOTAL</div><div style={{fontSize:28,fontWeight:900,marginTop:4}}>{slideData?.total_funding || fmtMoney(values.reduce((a,b)=>a+(Number(b)||0),0))}</div></div>
        {categories.slice(0,3).map((cat,i)=>{const st=statuses[i]; return <div key={cat} style={{border:"1px solid #E5E7EB",borderLeft:`4px solid ${statusColor(st)}`,borderRadius:7,padding:"8px 10px",marginBottom:7,background:"#F9FAFB"}}><div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:900,color:"#6B7280"}}><span>{String(cat).toUpperCase()}</span><span style={{fontSize:8,color:st==="estimate"?"#D97706":st==="projected"?"#7C3AED":"#16A34A",whiteSpace:"nowrap",minWidth:56,textAlign:"right"}}>{statusLabel(st)}</span></div><div style={{fontSize:22,fontWeight:900,color:statusColor(st)}}>{fmtMoney(values[i])}</div></div>})}
      </div>
    </div>
  </div>
}

function ChartPreview({ chartData, mode}) {
  if (chartData?.statuses && chartData?.categories && chartData?.series?.[0]?.name?.toLowerCase?.().includes("hb3")) return <Hb3FundsPreview chartData={chartData} />;
  if (chartData?.statuses && chartData?.categories && chartData?.series?.length === 1) return <Hb3FundsPreview chartData={chartData} />;
  if (chartData?.dashboard_type === "postsecondary_readiness") return <PostsecondaryReadinessPreview chartData={chartData} />;
  if (chartData?.series?.some?.(s => Object.prototype.hasOwnProperty.call(s, "available"))) return <DistrictProfilePreview chartData={chartData} />;
  if (chartData?.on_pathway !== undefined && chartData?.not_on_pathway !== undefined) return <CcmrPathwayPreview chartData={chartData} />;
  if (!chartData?.series?.length || !chartData?.categories?.length) return null;
  if(isCcmrAfAccountabilityPreview(chartData)){
    return <CcmrAfAccountabilityPreview chartData={chartData} />;
  }
  const categories = chartData.categories;
  const series = [...chartData.series].sort((a,b)=>{
    const rank = n => String(n || "").toLowerCase().includes("not met") ? 0 : (String(n || "").toLowerCase().includes("met") ? 1 : 2);
    return rank(a?.name) - rank(b?.name);
  });
  const isHBar = series.length === 1;
  const isHStacked = shouldUseHorizontalStackedPreview({series, categories});
  const W=560, H=(isHBar||isHStacked)?Math.max(150,categories.length*38+58):220;
  const pL=(isHBar||isHStacked)?Math.min(245,Math.max(140,7*Math.max(...categories.map(c=>campusLabel(c).length)))):36;
  const pB=42,pT=12,pR=20,cW=W-pL-pR,cH=H-pT-pB;
  const fmt=v=>mode==="percent"?`${Number(v).toFixed(1)}%`:String(Math.round(Number(v)));
  let maxV=0;
  categories.forEach((_,ci)=>{const s=series.reduce((a,sr)=>a+(Number(sr.values?.[ci])||0),0);if(s>maxV)maxV=s;});
  maxV=mode==="percent"?100:(Math.ceil((maxV*1.1)/10)*10||100);

  if(isCcmrYoyCards({categories, series})){
    const yearColors = ["#003291", "#00B0F0", "#D97706"];
    const headerColors = ["#003291", "#0F766E", "#00B0F0"];
    const subtitles = { TSI:"CCMR Overall", IBC:"Industry Based Certification", Enrollment:"College Enrollment" };
    const fmtValue = v => mode==="percent" ? `${Number(v).toFixed(1)}%` : String(Math.round(Number(v)));
    return(
      <div style={{width:"100%",maxWidth:900,margin:"0 auto",fontFamily:"Arial, sans-serif"}}>
        <div style={{textAlign:"center",fontWeight:900,color:"#003291",letterSpacing:".06em",margin:"4px 0 12px"}}>YEAR-OVER-YEAR COMPARISON</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:12}}>
          {categories.slice(0,3).map((metric,ci)=>{
            const maxCard = mode==="percent" ? 100 : Math.max(1,...series.map(s=>Number(s.values?.[ci])||0));
            const first = Number(series[0]?.values?.[ci])||0;
            const last = Number(series[Math.min(2,series.length-1)]?.values?.[ci])||0;
            const diff = last-first;
            return(
              <div key={metric} style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:8,overflow:"hidden",boxShadow:"0 2px 7px rgba(15,23,42,.12)"}}>
                <div style={{height:52,background:`linear-gradient(135deg, ${headerColors[ci%headerColors.length]}, #003291)`,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column"}}>
                  <div style={{fontSize:18,fontWeight:900,lineHeight:1}}>{metric}</div>
                  <div style={{fontSize:10,fontWeight:700,marginTop:4}}>({subtitles[metric]||""})</div>
                </div>
                <svg viewBox="0 0 260 210" style={{width:"100%",height:210,display:"block"}}>
                  {[0,20,40,60,80,100].filter(t=>t<=maxCard).map(t=>{const y=170-(t/maxCard)*125;return <g key={t}><line x1="36" y1={y} x2="242" y2={y} stroke="#E5E7EB" strokeDasharray="3 4"/><text x="30" y={y+4} textAnchor="end" fontSize="9" fill="#1F2933">{t}{mode==="percent"?"%":""}</text></g>})}
                  <line x1="36" y1="45" x2="36" y2="170" stroke="#9CA3AF"/>
                  <line x1="36" y1="170" x2="242" y2="170" stroke="#9CA3AF"/>
                  {series.slice(0,3).map((sr,si)=>{
                    const val=Number(sr.values?.[ci])||0;
                    const bh=(val/maxCard)*125;
                    const x=62+si*62;
                    const y=170-bh;
                    return <g key={sr.name}><rect x={x} y={y} width="36" height={Math.max(2,bh)} rx="4" fill={yearColors[si%yearColors.length]}/><text x={x+18} y={y-6} textAnchor="middle" fontSize="10" fontWeight="800" fill={yearColors[si%yearColors.length]}>{fmtValue(val)}</text><text x={x+18} y="190" textAnchor="middle" fontSize="9" fill="#1F2933">{sr.name}</text></g>
                  })}
                </svg>
                <div style={{margin:"0 14px 12px",background:"#EFF6FF",borderRadius:6,padding:"7px 8px",textAlign:"center",fontSize:11,fontWeight:800,color:headerColors[ci%headerColors.length]}}>
                  ▲ {mode==="percent" ? `${diff>=0?"+":""}${diff.toFixed(1)} pp` : `${diff>=0?"+":""}${Math.round(diff)}`} from {series[0]?.name} to {series[Math.min(2,series.length-1)]?.name}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    );
  }

  if(isHBar||isHStacked){
    const barH=Math.min(24,Math.max(10,cH/categories.length-7));
    const gap=(cH-barH*categories.length)/(categories.length+1);
    return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:W,display:"block",margin:"0 auto",overflow:"visible"}}>
      {[0,20,40,60,80,100].filter(v=>v<=maxV).map(v=>{const x=pL+(v/maxV)*cW;return<g key={v}><line x1={x} y1={pT} x2={x} y2={H-pB} stroke="#E5E7EB" strokeWidth="1"/><text x={x} y={H-pB+12} textAnchor="middle" fontSize="9" fill="#9CA3AF">{v}</text></g>;})}
      {categories.map((cat,ci)=>{
        const y=pT+gap+ci*(barH+gap);
        let xCursor=pL;
        return(<g key={ci}>
          <text x={pL-6} y={y+barH/2+3} textAnchor="end" fontSize="10" fill="#374151">{campusLabel(cat)}</text>
          {series.map((sr,si)=>{
            const val=Number(sr.values?.[ci])||0;
            const bw=(val/maxV)*cW;
            const x=xCursor;
            xCursor+=bw;
            return(<g key={si}>
              <rect x={x} y={y} width={Math.max(bw,2)} height={barH} fill={getSeriesColor(sr?.name,si)} rx="2"/>
              {bw>36&&<text x={x+bw/2} y={y+barH/2+3} textAnchor="middle" fontSize="8" fontWeight="bold" fill="#fff">{fmt(val)}</text>}
            </g>);
          })}
        </g>);
      })}
      <line x1={pL} y1={H-pB} x2={W-pR} y2={H-pB} stroke="#D1D5DB"/>
      {series.map((sr,si)=><g key={si} transform={`translate(${pL+si*120},${H-5})`}><rect x="0" y="-7" width="9" height="9" fill={getSeriesColor(sr?.name,si)}/><text x="12" y="1" fontSize="8" fill="#374151">{sr.name.length>14?sr.name.slice(0,14)+"…":sr.name}</text></g>)}
    </svg>);
  }

  const colW=Math.max(12,Math.min(44,cW/categories.length-8)),space=cW/categories.length;
  return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:W,display:"block",margin:"0 auto",overflow:"visible"}}>
    {[0,20,40,60,80,100].filter(v=>v<=maxV).map(v=>{const y=pT+cH-(v/maxV)*cH;return<g key={v}><line x1={pL} y1={y} x2={W-pR} y2={y} stroke="#E5E7EB" strokeWidth="1"/><text x={pL-3} y={y+3} textAnchor="end" fontSize="9" fill="#9CA3AF">{v}</text></g>;})}
    {categories.map((cat,ci)=>{const cx=pL+ci*space+space/2;let base=0;return(<g key={ci}>{series.map((sr,si)=>{const val=Number(sr.values?.[ci])||0,bh=(val/maxV)*cH,y=pT+cH-(base+val)/maxV*cH;base+=val;return(<g key={si}><rect x={cx-colW/2} y={y} width={colW} height={bh} fill={getSeriesColor(sr?.name,si)} rx="1"/>{bh>12&&<text x={cx} y={y+bh/2+3} textAnchor="middle" fontSize="8" fontWeight="bold" fill="#fff">{fmt(val)}</text>}</g>);})}<text x={cx} y={H-pB+12} textAnchor="middle" fontSize="9" fill="#374151">{String(cat).length>6?String(cat).slice(0,6)+"…":cat}</text></g>);})}
    <line x1={pL} y1={pT} x2={pL} y2={H-pB} stroke="#D1D5DB"/><line x1={pL} y1={H-pB} x2={W-pR} y2={H-pB} stroke="#D1D5DB"/>
    {series.map((sr,si)=><g key={si} transform={`translate(${pL+si*120},${H-5})`}><rect x="0" y="-7" width="9" height="9" fill={getSeriesColor(sr?.name,si)}/><text x="12" y="1" fontSize="8" fill="#374151">{sr.name.length>14?sr.name.slice(0,14)+"…":sr.name}</text></g>)}
  </svg>);
}

function MapRow({field,colOverrides,fileColumns,setColOverrides,manualVals,setManualVals,resetPreview}){
  const val=colOverrides[field.key]||"",isManual=val===MANUAL,isMissing=!field.optional&&!val;
  return(<div className={`map-row ${isMissing?"missing":""}`}>
    <div className="map-info">
      <span className="map-label">{field.label}{field.optional&&<span className="opt-tag">optional</span>}</span>
      <span className="map-desc">{field.description}</span>
    </div>
    <div className="map-col-right">
      <select className={`select map-sel ${isMissing?"select-error":val&&!isManual?"select-ok":isManual?"select-manual":""}`}
        value={val} onChange={e=>{setColOverrides(p=>({...p,[field.key]:e.target.value}));resetPreview();}}>
        <option value="">— Select column —</option>
        {fileColumns.map(c=><option key={c} value={c}>{c}</option>)}
        <option value={MANUAL}>✏️ Enter manually…</option>
      </select>
      {isManual&&<input type="text" className="text-input manual-col-input" placeholder={`Type ${field.label}…`} value={manualVals[field.key]||""} onChange={e=>{setManualVals(p=>({...p,[field.key]:e.target.value}));resetPreview();}}/>}
    </div>
  </div>);
}

const Badge=({connected, retrying})=>(
  <div className={`status-badge ${connected===null?"checking":connected?"connected":"disconnected"}`}>
    {connected===null&&retrying&&<span className="spinner" style={{width:10,height:10,marginRight:4}}/>}
    {connected===null&&!retrying&&<span className="status-dot"/>}
    {connected!==null&&<span className="status-dot"/>}
    {connected===null?(retrying?"Warming up…":"Connecting…"):connected?"Connected":"Offline"}
  </div>
);
const Num=({n})=><span className="step-num">{n}</span>;

// ── Slide type metadata ───────────────────────────────────────────────────────
// thumb: pixel-accurate SVG miniatures matching actual generated slide layouts
const SLIDE_THUMB = {

  // ── COVER: navy bg, red top/bottom stripes, decorative circles top-right,
  //          big white district title, cyan meeting type, italic subtitle,
  //          red date pill bottom-left, EMC logo bottom-right
  "cover": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#003291"/>
      {/* red top/bottom stripes */}
      <rect x="0" y="0"  width="160" height="2.5" fill="#E8192C"/>
      <rect x="0" y="87.5" width="160" height="2.5" fill="#E8192C"/>
      {/* decorative concentric circles — top-right, semi-clipped */}
      <circle cx="152" cy="0"  r="48" fill="none" stroke="#112060" strokeWidth="14"/>
      <circle cx="152" cy="0"  r="30" fill="none" stroke="#112060" strokeWidth="10"/>
      <circle cx="152" cy="0"  r="16" fill="none" stroke="#112060" strokeWidth="7"/>
      {/* big district title */}
      <rect x="10" y="24" width="78" height="9"   rx="2" fill="#ffffff"/>
      {/* cyan meeting type */}
      <rect x="10" y="37" width="54" height="5.5" rx="1" fill="#00B0F0"/>
      {/* italic subtitle */}
      <rect x="10" y="46" width="40" height="3"   rx="1" fill="#ffffff" opacity=".45"/>
      {/* red date pill */}
      <rect x="10" y="54" width="26" height="8"   rx="4" fill="#E8192C"/>
      <rect x="14" y="57" width="18" height="2.5" rx="1" fill="#ffffff"/>
      {/* EMC logo bottom-right: outer ring + inner red ring */}
      <circle cx="147" cy="78" r="9"   fill="none" stroke="#2d4a8a" strokeWidth="2"/>
      <circle cx="147" cy="78" r="5.5" fill="none" stroke="#E8192C"  strokeWidth="1.8"/>
      <line   x1="138" y1="78" x2="156" y2="78" stroke="#2d4a8a" strokeWidth="1"/>
      <line   x1="147" y1="69" x2="147" y2="87" stroke="#2d4a8a" strokeWidth="1"/>
    </svg>
  ),

  // ── MISSION: split-panel — left 52% is deep-blue panel with mission text
  //             + red vertical bar on far left edge + EMC logo bottom-left;
  //             right 48% is a photo placeholder (lighter navy)
  "mission": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      {/* right photo panel */}
      <rect width="160" height="90" fill="#1e3a6e"/>
      {/* left blue panel */}
      <rect x="4" y="0" width="81" height="90" fill="#003DA5"/>
      {/* red vertical bar on far left */}
      <rect x="0" y="0" width="4" height="90" fill="#E8192C"/>
      {/* red bottom bar on left panel */}
      <rect x="4" y="87" width="81" height="3" fill="#E8192C"/>
      {/* "Our Mission" label + underline */}
      <rect x="12" y="10" width="28" height="3.5" rx="1" fill="#00B0F0"/>
      <rect x="12" y="15" width="18" height="1.5" rx="0.5" fill="#E8192C"/>
      {/* main mission text: "Every Learner On A Path To" */}
      <rect x="12" y="20" width="66" height="7"   rx="1.5" fill="#ffffff"/>
      <rect x="12" y="30" width="58" height="7"   rx="1.5" fill="#ffffff"/>
      {/* "A Living Wage" in cyan */}
      <rect x="12" y="40" width="56" height="7"   rx="1.5" fill="#00B0F0"/>
      {/* subtext */}
      <rect x="12" y="51" width="64" height="3"   rx="1" fill="#ffffff" opacity=".55"/>
      {/* EMC logo bottom-left panel */}
      <circle cx="22" cy="76" r="8"   fill="none" stroke="#2d5aad" strokeWidth="1.8"/>
      <circle cx="22" cy="76" r="4.8" fill="none" stroke="#E8192C"  strokeWidth="1.4"/>
      <line   x1="14" y1="76" x2="30" y2="76" stroke="#2d5aad" strokeWidth="0.8"/>
      <line   x1="22" y1="68" x2="22" y2="84" stroke="#2d5aad" strokeWidth="0.8"/>
      {/* right panel: faint photo placeholder text */}
      <rect x="100" y="38" width="36" height="4" rx="1" fill="#ffffff" opacity=".1"/>
      <rect x="108" y="45" width="20" height="3" rx="1" fill="#ffffff" opacity=".08"/>
      {/* EMC logo overlay on photo, bottom-center */}
      <circle cx="130" cy="76" r="7"   fill="rgba(0,0,0,.25)" />
      <circle cx="130" cy="76" r="7"   fill="none" stroke="#ffffff" strokeWidth="1.2" opacity=".5"/>
    </svg>
  ),

  // ── TSI STATUS TRENDS: white bg, navy top bar, centered header,
  //    gradient divider, stacked column chart (Met/Approaches/Not-Met) by year
  "tsi_status_trends": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#ffffff"/>
      <rect width="160" height="3.5" fill="#003291"/>
      {/* header */}
      <rect x="28" y="7"  width="104" height="5.5" rx="1.5" fill="#003291"/>
      <rect x="50" y="15" width="60"  height="3.5" rx="1"   fill="#00B0F0"/>
      {/* gradient divider */}
      <defs>
        <linearGradient id="divTSI" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#003291"/>
          <stop offset="60%"  stopColor="#00B0F0"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <rect x="6" y="21" width="148" height="1.5" fill="url(#divTSI)"/>
      {/* stacked bars: 5 year-groups, 3 series each */}
      {[0,1,2,3,4].map(i=>{
        const met=[32,38,45,50,56][i];
        const app=[18,16,14,13,12][i];
        const notm=30-met+18-app;
        const x=16+i*28; const bw=18; const base=83;
        return(
          <g key={i}>
            {/* Not Met (top) */}
            <rect x={x} y={base-met-app-notm+10} width={bw} height={notm}    rx="1" fill="#D1D5DB"/>
            {/* Approaches (mid) */}
            <rect x={x} y={base-met-app+10}       width={bw} height={app}    rx="1" fill="#93C5FD"/>
            {/* Met (bottom) */}
            <rect x={x} y={base-met+10}            width={bw} height={met}   rx="1" fill="#003291"/>
            {/* year label */}
            <rect x={x+1} y="85" width={bw-2} height="2.5" rx="1" fill="#9CA3AF"/>
          </g>
        );
      })}
      {/* baseline */}
      <line x1="8" y1="83" x2="152" y2="83" stroke="#E5E7EB" strokeWidth="1"/>
      {/* legend row */}
      <rect x="8"  y="88.5" width="7" height="3" rx="1" fill="#003291"/>
      <rect x="16" y="89"   width="14" height="2" rx="1" fill="#E5E7EB"/>
      <rect x="36" y="88.5" width="7" height="3" rx="1" fill="#93C5FD"/>
      <rect x="44" y="89"   width="22" height="2" rx="1" fill="#E5E7EB"/>
      <rect x="72" y="88.5" width="7" height="3" rx="1" fill="#D1D5DB"/>
      <rect x="80" y="89"   width="18" height="2" rx="1" fill="#E5E7EB"/>
    </svg>
  ),

  // ── TSI STATUS (by campus): white bg, navy top bar, centered header,
  //    stacked horizontal bars (Met navy / Approaches cyan / Not Met gray)
  "tsi_status": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#ffffff"/>
      <rect width="160" height="3.5" fill="#003291"/>
      {/* header */}
      <rect x="26" y="7"  width="108" height="5.5" rx="1.5" fill="#003291"/>
      <rect x="50" y="15" width="60"  height="3.5" rx="1"   fill="#00B0F0"/>
      <defs>
        <linearGradient id="divTSIs" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#003291"/>
          <stop offset="60%"  stopColor="#00B0F0"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <rect x="6" y="21" width="148" height="1.5" fill="url(#divTSIs)"/>
      {/* 5 campus rows */}
      {[0,1,2,3,4].map(i=>{
        const met=[62,54,70,47,75][i];
        const app=[16,20,14,23,12][i];
        const notm=100-met-app;
        const bStart=42; const bLen=110; const y=25+i*12;
        return(
          <g key={i}>
            {/* campus label */}
            <rect x="4" y={y+1} width="34" height="6" rx="1" fill="#E5E7EB"/>
            {/* Met */}
            <rect x={bStart}               y={y} width={bLen*met/100}  height="8" rx="1" fill="#003291" opacity=".85"/>
            {/* Approaches */}
            <rect x={bStart+bLen*met/100}  y={y} width={bLen*app/100}  height="8" rx="1" fill="#93C5FD" opacity=".9"/>
            {/* Not Met */}
            <rect x={bStart+bLen*(met+app)/100} y={y} width={bLen*notm/100} height="8" rx="1" fill="#D1D5DB"/>
          </g>
        );
      })}
      {/* legend */}
      <rect x="8"  y="87" width="7" height="3" rx="1" fill="#003291" opacity=".85"/>
      <rect x="16" y="87.5" width="10" height="2" rx="1" fill="#E5E7EB"/>
      <rect x="32" y="87" width="7" height="3" rx="1" fill="#93C5FD" opacity=".9"/>
      <rect x="40" y="87.5" width="18" height="2" rx="1" fill="#E5E7EB"/>
      <rect x="64" y="87" width="7" height="3" rx="1" fill="#D1D5DB"/>
      <rect x="72" y="87.5" width="14" height="2" rx="1" fill="#E5E7EB"/>
    </svg>
  ),

  // ── TSI LEADERBOARD: white bg, ranked horizontal bars (gold #1, navy rest),
  //    campus labels left, percent labels inside bars
  "tsi_leaderboard": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#ffffff"/>
      <rect width="160" height="3.5" fill="#003291"/>
      {/* header */}
      <rect x="10" y="7"  width="140" height="5.5" rx="1.5" fill="#003291"/>
      <rect x="40" y="15" width="80"  height="3.5" rx="1"   fill="#00B0F0"/>
      <defs>
        <linearGradient id="divLB" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#003291"/>
          <stop offset="60%"  stopColor="#00B0F0"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <rect x="6" y="22" width="148" height="1.5" fill="url(#divLB)"/>
      {/* ranked bars */}
      {[1,0.88,0.76,0.64,0.53,0.43].map((pct,i)=>{
        const maxW=108; const y=26+i*11;
        const isFirst=i===0;
        return(
          <g key={i}>
            {/* campus label */}
            <rect x="4" y={y+1} width="32" height="6" rx="1" fill="#E5E7EB"/>
            {/* bar */}
            <rect x="40" y={y} width={maxW*pct} height="8" rx="1.5"
              fill={isFirst?"#FFC000":"#003291"}
              opacity={isFirst?1:0.9-i*0.08}/>
            {/* border for gold bar */}
            {isFirst&&<rect x="40" y={y} width={maxW*pct} height="8" rx="1.5" fill="none" stroke="#D97706" strokeWidth="0.7"/>}
            {/* % label inside bar */}
            <rect x={40+maxW*pct-20} y={y+2} width="16" height="4" rx="1" fill="#ffffff" opacity=".6"/>
          </g>
        );
      })}
    </svg>
  ),

  // ── CCMR YOY BREAKDOWN: white bg, three metric cards (3 colors × 3–4 years)
  "ccmr_yoy_breakdown": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#ffffff"/>
      <rect width="160" height="3.5" fill="#003291"/>
      {/* header */}
      <rect x="30" y="7"  width="100" height="5.5" rx="1.5" fill="#003291"/>
      <rect x="50" y="15" width="60"  height="3.5" rx="1"   fill="#00B0F0"/>
      <defs>
        <linearGradient id="divCCMR" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#003291"/>
          <stop offset="60%"  stopColor="#00B0F0"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <rect x="6" y="22" width="148" height="1.5" fill="url(#divCCMR)"/>
      {/* 4 year-groups × 3 bars */}
      {[0,1,2,3].map(gi=>{
        const heights=[[30,20,40],[36,24,46],[42,28,52],[47,32,56]][gi];
        const colors=["#FFC000","#00B0F0","#003291"];
        const gx=14+gi*36;
        return(
          <g key={gi}>
            {heights.map((h,i)=>(
              <rect key={i} x={gx+i*11} y={83-h} width="9" height={h} rx="1.5"
                fill={colors[i]} opacity=".88"/>
            ))}
            {/* year label */}
            <rect x={gx+3} y="85" width="22" height="3" rx="1" fill="#E5E7EB"/>
          </g>
        );
      })}
      <line x1="8" y1="83" x2="152" y2="83" stroke="#E5E7EB" strokeWidth="1"/>
      {/* legend */}
      <rect x="8"  y="89" width="7" height="3" rx="1" fill="#FFC000"/>
      <rect x="16" y="89.5" width="12" height="2" rx="1" fill="#E5E7EB"/>
      <rect x="32" y="89" width="7" height="3" rx="1" fill="#00B0F0"/>
      <rect x="40" y="89.5" width="10" height="2" rx="1" fill="#E5E7EB"/>
      <rect x="54" y="89" width="7" height="3" rx="1" fill="#003291"/>
      <rect x="62" y="89.5" width="8" height="2" rx="1" fill="#E5E7EB"/>
    </svg>
  ),

  // ── CCMR A-F STATUS: white bg, navy left sidebar (logo + label + goal + count),
  //    right side: title + progress cards (Met green / Approaches yellow / Not Met red)
  "ccmr_af_status": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#ffffff"/>
      <rect width="160" height="3.5" fill="#003291"/>
      {/* navy left sidebar */}
      <rect x="0" y="0" width="44" height="90" fill="#003291"/>
      {/* logo in sidebar */}
      <circle cx="22" cy="12" r="7"   fill="none" stroke="#2d5aad" strokeWidth="1.5"/>
      <circle cx="22" cy="12" r="4.2" fill="none" stroke="#E8192C"  strokeWidth="1.2"/>
      {/* sidebar labels */}
      <rect x="6"  y="22" width="32" height="3.5" rx="1" fill="#00B0F0" opacity=".7"/>
      <rect x="6"  y="28" width="28" height="5"   rx="1" fill="#ffffff"/>
      <rect x="6"  y="36" width="22" height="3"   rx="1" fill="#ffffff" opacity=".5"/>
      {/* CCMR GOAL box */}
      <rect x="4" y="44" width="36" height="16" rx="2" fill="rgba(255,255,255,.08)"/>
      <rect x="8" y="47" width="20" height="3"  rx="1" fill="#00B0F0" opacity=".7"/>
      <rect x="8" y="52" width="24" height="5"  rx="1" fill="#FFC000"/>
      {/* TOTAL STUDENTS box */}
      <rect x="4" y="63" width="36" height="16" rx="2" fill="rgba(255,255,255,.08)"/>
      <rect x="8" y="66" width="24" height="3"  rx="1" fill="#00B0F0" opacity=".7"/>
      <rect x="8" y="71" width="28" height="5"  rx="1" fill="#ffffff"/>
      {/* right content title */}
      <rect x="50" y="8"  width="100" height="5" rx="1.5" fill="#003291"/>
      <rect x="50" y="16" width="76"  height="3" rx="1"   fill="#4B5563"/>
      {/* divider */}
      <defs>
        <linearGradient id="divAF" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#003291"/>
          <stop offset="70%"  stopColor="#00B0F0"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <rect x="48" y="22" width="108" height="1.5" fill="url(#divAF)"/>
      {/* Met card (green) */}
      <rect x="50" y="25" width="32" height="28" rx="2" fill="#F0FDF4" stroke="#16A34A" strokeWidth="1.2"/>
      <rect x="55" y="30" width="22" height="3"  rx="1" fill="#16A34A"/>
      <rect x="55" y="36" width="18" height="7"  rx="1" fill="#16A34A"/>
      <rect x="55" y="45" width="20" height="3"  rx="1" fill="#16A34A" opacity=".5"/>
      {/* Approaches card (yellow) */}
      <rect x="87" y="25" width="32" height="28" rx="2" fill="#FFFBEB" stroke="#FFC000" strokeWidth="1.2"/>
      <rect x="92" y="30" width="22" height="3"  rx="1" fill="#D97706"/>
      <rect x="92" y="36" width="18" height="7"  rx="1" fill="#FFC000"/>
      <rect x="92" y="45" width="20" height="3"  rx="1" fill="#D97706" opacity=".5"/>
      {/* Not Met card (red) */}
      <rect x="124" y="25" width="32" height="28" rx="2" fill="#FEF2F2" stroke="#E8192C" strokeWidth="1.2"/>
      <rect x="129" y="30" width="22" height="3"  rx="1" fill="#E8192C"/>
      <rect x="129" y="36" width="18" height="7"  rx="1" fill="#E8192C"/>
      <rect x="129" y="45" width="20" height="3"  rx="1" fill="#E8192C" opacity=".5"/>
      {/* progress bars below cards */}
      <rect x="50"  y="58" width="106" height="3" rx="1" fill="#E5E7EB"/>
      <rect x="50"  y="58" width="72"  height="3" rx="1" fill="#16A34A" opacity=".7"/>
    </svg>
  ),

  // ── CCMR PATHWAY ANALYSIS: white bg, red alert box left (NOT ON PATHWAY count),
  //    right side: pathway breakdown bars (stacked per-pathway)
  "ccmr_pathway": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#ffffff"/>
      <rect width="160" height="3.5" fill="#003291"/>
      {/* header */}
      <rect x="6"  y="7"  width="60" height="3.5" rx="1" fill="#E8192C"/>
      <rect x="6"  y="13" width="50" height="5"   rx="1" fill="#003291"/>
      <rect x="6"  y="20" width="70" height="3"   rx="1" fill="#4B5563" opacity=".6"/>
      <defs>
        <linearGradient id="divCP" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#003291"/>
          <stop offset="60%"  stopColor="#00B0F0"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <rect x="6" y="25" width="148" height="1.5" fill="url(#divCP)"/>
      {/* left red alert box */}
      <rect x="6" y="29" width="36" height="54" rx="3" fill="#E8192C"/>
      {/* ! icon */}
      <circle cx="24" cy="37" r="5" fill="rgba(255,255,255,.25)"/>
      <rect x="22.5" y="33.5" width="3" height="5"  rx="1" fill="#ffffff"/>
      <rect x="22.5" y="40"   width="3" height="3"  rx="1" fill="#ffffff"/>
      {/* big count */}
      <rect x="10" y="44" width="28" height="9" rx="2" fill="#ffffff" opacity=".9"/>
      {/* label */}
      <rect x="10" y="56" width="28" height="3" rx="1" fill="#ffffff" opacity=".7"/>
      <rect x="10" y="61" width="28" height="3" rx="1" fill="#ffffff" opacity=".7"/>
      {/* % badge */}
      <rect x="12" y="67" width="24" height="5" rx="2.5" fill="rgba(255,255,255,.2)"/>
      <rect x="15" y="68.5" width="18" height="2" rx="1" fill="#ffffff" opacity=".8"/>
      {/* right pathway bars */}
      {[0,1,2,3,4,5].map(i=>{
        const barW=[80,64,72,50,58,42][i];
        const y=29+i*9;
        const colors=["#003291","#00B0F0","#003291","#00B0F0","#FFC000","#003291"];
        return(
          <g key={i}>
            <rect x="46" y={y} width="52" height="7" rx="1" fill="#003291" opacity=".1"/>
            <rect x="46" y={y} width={barW*0.82} height="7" rx="1" fill={colors[i]} opacity=".8"/>
            <rect x="100" y={y+1} width="54" height="5" rx="1" fill="#E5E7EB" opacity=".4"/>
            <rect x="100" y={y+1} width="32" height="5" rx="1" fill={colors[i]} opacity=".35"/>
          </g>
        );
      })}
    </svg>
  ),

  // ── CCMR ALL QUALIFIERS: white bg, horizontal bars grouped by qualifier type
  "ccmr_pathway_full": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#ffffff"/>
      <rect width="160" height="3.5" fill="#003291"/>
      {/* header */}
      <rect x="10" y="7"  width="140" height="5.5" rx="1.5" fill="#003291"/>
      <rect x="40" y="15" width="80"  height="3.5" rx="1"   fill="#00B0F0"/>
      <defs>
        <linearGradient id="divPF" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#003291"/>
          <stop offset="60%"  stopColor="#00B0F0"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <rect x="6" y="22" width="148" height="1.5" fill="url(#divPF)"/>
      {/* qualifier rows with two bars side-by-side (campus % + % of CCMR-met) */}
      {[0,1,2,3,4,5,6].map(i=>{
        const w1=[90,74,58,82,48,64,38][i];
        const w2=[w1*0.65,w1*0.72,w1*0.58,w1*0.80,w1*0.50,w1*0.62,w1*0.45].map(v=>Math.round(v))[i];
        const colors=["#003291","#00B0F0","#003291","#00B0F0","#FFC000","#003291","#00B0F0"];
        return(
          <g key={i}>
            {/* label */}
            <rect x="4"  y={25+i*9} width="38" height="6" rx="1" fill="#E5E7EB"/>
            {/* main bar */}
            <rect x="46" y={25+i*9} width={w1*0.95} height="6" rx="1" fill={colors[i]} opacity=".75"/>
            {/* secondary bar (lighter) */}
            <rect x="46" y={25+i*9} width={w2*0.95} height="6" rx="1" fill={colors[i]} opacity=".4"/>
          </g>
        );
      })}
    </svg>
  ),

  // ── DISTRICT PROFILE: white bg, navy top bar + title,
  //    5 metric columns each with stacked mini bars (3 years)
  "district_profile": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#ffffff"/>
      <rect width="160" height="3.5" fill="#003291"/>
      {/* header row */}
      <rect x="6"  y="7"  width="110" height="5.5" rx="1.5" fill="#003291"/>
      <rect x="6"  y="15" width="50"  height="3"   rx="1"   fill="#00B0F0"/>
      <rect x="138" y="8" width="18"  height="4"   rx="1"   fill="#6B7280" opacity=".4"/>
      {/* color legend row */}
      <rect x="6"  y="20" width="7" height="4" rx="1" fill="#93C5FD"/>
      <rect x="15" y="21" width="16" height="2" rx="1" fill="#E5E7EB"/>
      <rect x="34" y="20" width="7" height="4" rx="1" fill="#1D4ED8"/>
      <rect x="43" y="21" width="16" height="2" rx="1" fill="#E5E7EB"/>
      <rect x="62" y="20" width="7" height="4" rx="1" fill="#003291"/>
      <rect x="71" y="21" width="16" height="2" rx="1" fill="#E5E7EB"/>
      <defs>
        <linearGradient id="divDP" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#003291"/>
          <stop offset="60%"  stopColor="#00B0F0"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <rect x="6" y="26" width="148" height="1.5" fill="url(#divDP)"/>
      {/* 5 column tiles with borders */}
      {[0,1,2,3,4].map(col=>{
        const x=6+col*30; const tileW=28;
        const labelH=[32,28,42,38,35][col];
        const barH1=[labelH*0.72,labelH*0.60,labelH*0.75,labelH*0.68,labelH*0.55].map(v=>Math.round(v))[col];
        const barH2=[labelH*0.50,labelH*0.44,labelH*0.60,labelH*0.52,labelH*0.42].map(v=>Math.round(v))[col];
        const barH3=labelH;
        return(
          <g key={col}>
            {/* tile border */}
            <rect x={x} y="30" width={tileW} height="56" rx="2" fill="#F9FAFB" stroke="#9CA3AF" strokeWidth="1.2"/>
            {/* column title */}
            <rect x={x+3} y="33" width={tileW-6} height="7" rx="1" fill="#003291" opacity=".8"/>
            {/* 3-bar mini chart */}
            {/* bar 2023 (lightest) */}
            <rect x={x+4}    y={88-barH1}   width="6" height={barH1}   rx="1" fill="#93C5FD"/>
            {/* bar 2024 */}
            <rect x={x+12}   y={88-barH2}   width="6" height={barH2}   rx="1" fill="#1D4ED8"/>
            {/* bar 2025 (darkest) */}
            <rect x={x+20}   y={88-barH3}   width="6" height={barH3}   rx="1" fill="#003291"/>
            {/* baseline */}
            <line x1={x+2} y1="85" x2={x+tileW-2} y2="85" stroke="#D1D5DB" strokeWidth="0.8"/>
          </g>
        );
      })}
    </svg>
  ),

  // ── POSTSECONDARY READINESS: dashboard cards, campus comparison, opportunity gaps
  "postsecondary_enrollment": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#ffffff"/>
      <rect width="160" height="3.5" fill="#003291"/>
      {/* header */}
      <rect x="18" y="7"  width="124" height="5.5" rx="1.5" fill="#003291"/>
      <rect x="50" y="15" width="60"  height="3.5" rx="1"   fill="#00B0F0"/>
      <defs>
        <linearGradient id="divPSE" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#003291"/>
          <stop offset="60%"  stopColor="#00B0F0"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <rect x="6" y="22" width="148" height="1.5" fill="url(#divPSE)"/>
      {/* 5 campus rows */}
      {[0,1,2,3,4].map(i=>{
        const p4=[0.50,0.44,0.37,0.57,0.33][i];
        const p2=[0.18,0.20,0.24,0.14,0.26][i];
        const pN=1-p4-p2;
        const bStart=42; const bLen=112; const y=25+i*12;
        return(
          <g key={i}>
            <rect x="4" y={y+1} width="34" height="7" rx="1" fill="#E5E7EB"/>
            {/* 4YR */}
            <rect x={bStart}                  y={y} width={bLen*p4}  height="9" rx="1" fill="#003291" opacity=".85"/>
            {/* 2YR */}
            <rect x={bStart+bLen*p4}          y={y} width={bLen*p2}  height="9" rx="1" fill="#00B0F0" opacity=".85"/>
            {/* Not Enrolled */}
            <rect x={bStart+bLen*(p4+p2)}     y={y} width={bLen*pN}  height="9" rx="1" fill="#E5E7EB"/>
          </g>
        );
      })}
      {/* legend */}
      <rect x="8"  y="87" width="7" height="3" rx="1" fill="#003291" opacity=".85"/>
      <rect x="16" y="87.5" width="10" height="2" rx="1" fill="#E5E7EB"/>
      <rect x="30" y="87" width="7" height="3" rx="1" fill="#00B0F0" opacity=".85"/>
      <rect x="38" y="87.5" width="8" height="2" rx="1" fill="#E5E7EB"/>
      <rect x="50" y="87" width="7" height="3" rx="1" fill="#D1D5DB"/>
      <rect x="58" y="87.5" width="20" height="2" rx="1" fill="#E5E7EB"/>
    </svg>
  ),

  // ── HB3 OUTCOMES BONUS: white bg, left chart (bars by class year),
  //    right sidebar (total funding card + breakdown)
  "hb3_funds": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#ffffff"/>
      <rect width="160" height="3.5" fill="#003291"/>
      {/* header */}
      <rect x="6"  y="7"  width="50"  height="3.5" rx="1" fill="#00B0F0"/>
      <rect x="6"  y="13" width="90"  height="5.5" rx="1.5" fill="#003291"/>
      <rect x="6"  y="21" width="50"  height="3.5" rx="1" fill="#00B0F0" opacity=".6"/>
      <defs>
        <linearGradient id="divHB3" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#003291"/>
          <stop offset="60%"  stopColor="#00B0F0"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <rect x="6" y="27" width="148" height="1.5" fill="url(#divHB3)"/>
      {/* left chart: grouped bars per class year, Eco-Dis / Non-Eco-Dis */}
      {[0,1,2,3].map(gi=>{
        const hEco=[30,38,44,50][gi];
        const hNon=[20,26,30,36][gi];
        const x=10+gi*32;
        return(
          <g key={gi}>
            <rect x={x}    y={84-hEco} width="12" height={hEco} rx="1.5" fill="#003291" opacity=".85"/>
            <rect x={x+14} y={84-hNon} width="12" height={hNon} rx="1.5" fill="#00B0F0" opacity=".85"/>
            <rect x={x+2}  y="86" width="22" height="3" rx="1" fill="#E5E7EB"/>
          </g>
        );
      })}
      <line x1="8" y1="84" x2="138" y2="84" stroke="#E5E7EB" strokeWidth="1"/>
      {/* right sidebar */}
      <rect x="142" y="30" width="14" height="4"  rx="1" fill="#00B0F0" opacity=".7"/>
      <rect x="142" y="37" width="14" height="8"  rx="1" fill="#003291"/>
      <rect x="142" y="48" width="14" height="3"  rx="1" fill="#9CA3AF"/>
      <rect x="142" y="54" width="14" height="14" rx="2" fill="#FFC000" opacity=".2" stroke="#FFC000" strokeWidth="1"/>
      <rect x="143" y="57" width="12" height="3"  rx="1" fill="#FFC000"/>
      <rect x="143" y="62" width="10" height="3"  rx="1" fill="#D97706" opacity=".6"/>
      {/* legend */}
      <rect x="8"  y="89" width="7" height="3" rx="1" fill="#003291" opacity=".85"/>
      <rect x="16" y="89.5" width="20" height="2" rx="1" fill="#E5E7EB"/>
      <rect x="42" y="89" width="7" height="3" rx="1" fill="#00B0F0" opacity=".85"/>
      <rect x="50" y="89.5" width="22" height="2" rx="1" fill="#E5E7EB"/>
    </svg>
  ),

  // ── OUTRO / THANK YOU: navy bg, red top/bottom stripes, large decorative circles,
  //    centered "Thank You" title, EMC sub-label, mission tagline
  "outro": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#003291"/>
      {/* red top/bottom stripes */}
      <rect x="0" y="0"    width="160" height="2.5" fill="#E8192C"/>
      <rect x="0" y="87.5" width="160" height="2.5" fill="#E8192C"/>
      {/* large decorative circles (left, right, center) */}
      <circle cx="16"  cy="45" r="42" fill="none" stroke="#112060" strokeWidth="18"/>
      <circle cx="144" cy="45" r="42" fill="none" stroke="#112060" strokeWidth="18"/>
      <circle cx="80"  cy="45" r="28" fill="none" stroke="#1e1e5a" strokeWidth="12"/>
      {/* EMC label */}
      <rect x="52" y="22" width="56" height="3.5" rx="1" fill="#00B0F0" opacity=".8"/>
      {/* "Thank You" big title */}
      <rect x="26" y="29" width="108" height="11"  rx="2.5" fill="#ffffff"/>
      {/* red divider line */}
      <rect x="68" y="44" width="24" height="2" rx="1" fill="#E8192C"/>
      {/* tagline */}
      <rect x="34" y="50" width="92" height="3" rx="1" fill="#ffffff" opacity=".35"/>
      {/* EMC logo bottom-center */}
      <circle cx="80" cy="72" r="9"   fill="none" stroke="#2d4a8a" strokeWidth="2"/>
      <circle cx="80" cy="72" r="5.5" fill="none" stroke="#E8192C"  strokeWidth="1.8"/>
      <line   x1="71" y1="72" x2="89" y2="72" stroke="#2d4a8a" strokeWidth="1"/>
      <line   x1="80" y1="63" x2="80" y2="81" stroke="#2d4a8a" strokeWidth="1"/>
    </svg>
  ),

};

const SLIDE_INFO = {
  "cover":                   {name:"Cover Slide",           icon:"🎯", desc:"Title slide with district name, meeting type, and date", needsData:false},
  "mission":                 {name:"EMC Mission",            icon:"🌟", desc:"Every Learner On A Path To A Living Wage", needsData:false},
  "district_profile":        {name:"District Profile",       icon:"🏛️", desc:"6-metric profile by cohort: CCMR, TSI, IBC, financial aid, enrollment, degree", needsData:true},
  "ccmr_pathway_full":       {name:"CCMR All Qualifiers",    icon:"🗺️", desc:"Full CCMR pathway breakdown: TSI ELAR, TSI Math, IBC, Dual Credit, AP/IB, OnRamps, and more", needsData:true},
  "outro":                   {name:"Outro / Thank You",    icon:"🙏", desc:"Closing thank you slide with district name and EMC mission", needsData:false},
  "hb3_funds":               {name:"HB3 Outcomes Bonus",     icon:"💰", desc:"HB3 funding by class year with verified/estimate/projected status", needsData:true},
  "tsi_status_trends":       {name:"TSI Status Trends", icon:"📈", desc:"TSI Met and Not Met trends by year", needsData:true},
  "tsi_status":              {name:"TSI Status",        icon:"📊", desc:"TSI results by campus for the latest year", needsData:true},
  "tsi_leaderboard":         {name:"TSI Leaderboard",   icon:"🏆", desc:"Ranked horizontal bar chart of TSI rates", needsData:true},
  "ccmr_yoy_breakdown":      {name:"CCMR YOY Breakdown",   icon:"📉", desc:"CCMR indicators (TSI, IBC, Enrollment) year-over-year", needsData:true},
  "ccmr_af_status":          {name:"CCMR A-F Status",   icon:"🎓", desc:"Met / Approaches / Not Met with progress to 90% goal", needsData:true},
  "ccmr_pathway":            {name:"CCMR Pathway Analysis",icon:"🛤️",desc:"Students on/off CCMR pathway by type", needsData:true},
  "postsecondary_enrollment":{name:"Postsecondary Readiness",icon:"🎓",desc:"College application, financial aid, FAFSA, and acceptance readiness dashboard", needsData:true},
};

const DISTRICT_OPTIONS = [
  "Aldine ISD",
  "Crowley ISD",
  "Cedar Hill ISD",
  "Corpus Christi ISD",
  "Dallas ISD",
  "DeSoto ISD",
  "Duncanville ISD",
  "Gainesville ISD",
  "Garland ISD",
  "Grand Prairie ISD",
];

const MONTH_OPTIONS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const YEAR_OPTIONS = ["2022", "2023", "2024", "2025", "2026"];

const SOURCE_OPTIONS = [
  "CC Solutions",
  "District Salesforce",
  "Texas Education Agency (TEA)",
  "National Student Clearinghouse (NSC)",
  "Promise Salesforce",
];

const todayISO = () => new Date().toISOString().slice(0, 10);

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App(){
  const [showLanding,setShowLanding]=useState(true);
  const [connected,setConnected]=useState(null);
  const [categoryMenu,setCategoryMenu]=useState({});

  // Mode: "single" or "presentation"
  const [appMode,setAppMode]=useState("single");

  // Presentation builder state
  const [presSlides,setPresSlides]=useState([]); // [{slide_type, name, status:"pending"|"approved"|"skipped", config:{}}]
  const [presPhase,setPresPhase]=useState("plan"); // "plan" | "build" | "done"
  const [presCurrentIdx,setPresCurrentIdx]=useState(0);
  const [presFileCache,setPresFileCache]=useState(null);
  const [presMetaCache,setPresMetaCache]=useState({}); // auto-fill shared metadata
  const presMetaCacheRef = useRef({});            // always-current ref for async reads // {upload_path,inspection,selectedDistricts,selectedCampuses}
  // Change 8 & 9: Per-slide state snapshot for lossless back-navigation
  const presSlideStateCache = useRef({}); // {[idx]: {file,inspection,selectedDistricts,selectedCampuses,colOverrides,manualVals,colDetection,manualText,preview,editLabels,editSeries,editCategories,editInsights,uploadConfirmed,mode,aggLevel}}
  const [slidePreviewHtml,setSlidePreviewHtml]=useState(null); // HTML string for iframe preview
  const [showSlidePreview,setShowSlidePreview]=useState(false);
  const [fetchingPreview,setFetchingPreview]=useState(false);
  const [buildingPres,setBuildingPres]=useState(false);
  const [buildingPptx,setBuildingPptx]=useState(false);

  // Full-presentation quick build state
  const presBatchFileRef = useRef(null);
  const [presBatchFiles,setPresBatchFiles]=useState([]); // [{id,name,size,upload_path,error}]
  const [presBatchInspecting,setPresBatchInspecting]=useState(false);
  const [presFileAssignments,setPresFileAssignments]=useState({}); // {slideIndex: upload_path}
  const [quickBuilding,setQuickBuilding]=useState(""); // "html" | "pptx" | ""
  const [presQuickMeta,setPresQuickMeta]=useState({
    District:"",
    meeting_type:"Partner Meeting",
    subtitle:"",
    month:new Date().toLocaleString("en-US", {month:"long"}),
    year_label:String(new Date().getFullYear()),
    data_source:"District Salesforce",
    as_of_date:todayISO(),
    footnote:"",
  });

  // Single slide / current build step
  const [slideFields,setSlideFields]=useState(null);
  const [selectedType,setSelectedType]=useState("");
  const [supportsModes,setSupportsModes]=useState(["count"]);
  const [defaultAgg,setDefaultAgg]=useState("district");
  const [mode,setMode]=useState("count");
  const [aggLevel,setAggLevel]=useState("district");
  const [needsData,setNeedsData]=useState(true);

  // Pre-upload confirmation
  const [uploadConfirmed,setUploadConfirmed]=useState(false);

  // File + inspection
  const [file,setFile]=useState(null);
  const fileRef=useRef(null);
  const [inspecting,setInspecting]=useState(false);
  const [inspection,setInspection]=useState(null);
  const [fileError,setFileError]=useState("");
  const [showPreview,setShowPreview]=useState(false);

  // District/campus selection
  const [selectedDistricts,setSelectedDistricts]=useState([]);
  const [selectedCampuses,setSelectedCampuses]=useState({});
  const [expandedDistricts,setExpandedDistricts]=useState({});

  // Column detection
  const [colOverrides,setColOverrides]=useState({});
  const [manualVals,setManualVals]=useState({});
  const [colDetection,setColDetection]=useState(null);
  const [detecting,setDetecting]=useState(false);

  // Manual text fields (month, year, district label, footnote)
  const [manualText,setManualText]=useState({});

  // Preview
  const [previewing,setPreviewing]=useState(false);
  const [preview,setPreview]=useState(null);
  const [editLabels,setEditLabels]=useState({});
  const [editSeries,setEditSeries]=useState([]);
  const [editCategories,setEditCategories]=useState([]);
  const [editInsights,setEditInsights]=useState([]);

  // Ask Claude about the currently loaded dataset
  const [claudeQuestion,setClaudeQuestion]=useState("");
  const [claudeAnswer,setClaudeAnswer]=useState("");
  const [claudeAsking,setClaudeAsking]=useState(false);
  const [claudeError,setClaudeError]=useState("");

  // Generate
  const [generating,setGenerating]=useState(false);
  const [status,setStatus]=useState({type:"",msg:""});

  const [retrying, setRetrying] = useState(false);
  const retryTimerRef = useRef(null);
  const keepaliveRef = useRef(null);

  useEffect(()=>{startConnectionSequence();},[]);

  function startConnectionSequence(){
    setConnected(null);
    setRetrying(true);
    attemptConnect(0);
  }

  async function attemptConnect(attempt){
    try{
      const r=await axios.get(`${API}/health`,{timeout:8000});
      if(r.data?.status==="ok"){
        setConnected(true);
        setRetrying(false);
        loadMenu();
        startKeepalive();
      } else {
        scheduleRetry(attempt);
      }
    }catch{
      scheduleRetry(attempt);
    }
  }

  function scheduleRetry(attempt){
    if(attempt >= 15){ setConnected(false); setRetrying(false); return; }
    const delay = Math.min(4000 + attempt * 2000, 15000);
    retryTimerRef.current = setTimeout(()=>attemptConnect(attempt+1), delay);
  }

  function startKeepalive(){
    if(keepaliveRef.current) clearInterval(keepaliveRef.current);
    keepaliveRef.current = setInterval(async()=>{
      try{ await axios.get(`${API}/health`,{timeout:5000}); }catch{}
    }, 5 * 60 * 1000);
  }

  useEffect(()=>()=>{
    if(retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if(keepaliveRef.current) clearInterval(keepaliveRef.current);
  },[]);
  async function loadMenu(){
    try{
      const r=await axios.get(`${API}/category-menu`);
      const m=Object.fromEntries(Object.entries(r.data.category_menu||{}).filter(([,v])=>v?.length>0));
      setCategoryMenu(m);
    }catch{setStatus({type:"error",msg:"Could not load menu."});}
  }

  async function selectSlideType(type){
    setSelectedType(type);
    resetSlideState();
    if(!type)return;
    // Immediately apply the local slide data requirement so pre-built slides never
    // flash or fall back into the upload-file workflow while backend fields load.
    const localInfo = SLIDE_INFO[type];
    if(localInfo) setNeedsData(localInfo.needsData !== false);
    try{
      const r=await axios.get(`${API}/slide-fields/${type}`);
      setSlideFields(r.data);
      const ms=r.data.supports_modes||["count"]; setSupportsModes(ms); setMode(ms[0]);
      setDefaultAgg(r.data.default_agg||"district"); setAggLevel(r.data.default_agg||"district");
      setNeedsData(r.data.needs_data!==false);
      const initM={};
      const sharedKeys=["District","month","year_label","data_source","as_of_date","footnote"];
      const cache=presMetaCacheRef.current;
      for(const f of (r.data.manual_text_fields||[])){
        initM[f.key]=(sharedKeys.includes(f.key)&&cache[f.key])?cache[f.key]:(manualText[f.key]||"");
      }
      setManualText(initM);
    }catch{}
  }

  function resetSlideState(){
    setFile(null);setInspection(null);setFileError("");setShowPreview(false);setUploadConfirmed(false);
    setSelectedDistricts([]);setSelectedCampuses({});setExpandedDistricts({});
    setColOverrides({});setManualVals({});setColDetection(null);
    setPreview(null);setEditLabels({});setEditSeries([]);setEditCategories([]);setEditInsights([]);
    setStatus({type:"",msg:""});
    if(fileRef.current)fileRef.current.value="";
  }
  function resetPreview(){
    setPreview(null);setEditLabels({});setEditSeries([]);setEditCategories([]);setEditInsights([]);
    setClaudeQuestion("");setClaudeAnswer("");setClaudeError("");setClaudeAsking(false);
    setStatus({type:"",msg:""});
  }

  // ── Pre-upload confirmation ─────────────────────────────────────────────
  function handleConfirmUpload(e){
    setUploadConfirmed(e.target.checked);
  }

  // ── File upload ─────────────────────────────────────────────────────────
  async function handleFile(e){
    const f=e.target.files[0]; if(!f)return;
    setFile(f);setInspection(null);setFileError("");setShowPreview(false);
    setSelectedDistricts([]);setSelectedCampuses({});
    setColOverrides({});setManualVals({});setColDetection(null);setPreview(null);
    setStatus({type:"",msg:""});
    setInspecting(true);
    try{
      const fd=new FormData(); fd.append("slide_type",selectedType); fd.append("file",f);
      const r=await axios.post(`${API}/inspect-file`,fd);
      setInspection(r.data);
      const usable=r.data.districts.filter(d=>d.usable);
      const initM={};
      for(const ft of(r.data.manual_text_fields||[])) initM[ft.key]=manualText[ft.key]||"";
      setManualText(initM);
      if(usable.length===1){
        setSelectedDistricts([usable[0].sheet_name]);
        setSelectedCampuses({[usable[0].sheet_name]:[]});
        await detectColumns([usable[0].sheet_name],{[usable[0].sheet_name]:[]},r.data.upload_path);
      }else if(usable.length===0){
        setFileError("⚠ No compatible data found. Check column mapping below.");
        if(r.data.districts.length>0){
          await detectColumns([r.data.districts[0].sheet_name],{[r.data.districts[0].sheet_name]:[]},r.data.upload_path);
        }
      }
    }catch(err){
      setStatus({type:"error",msg:`✗ ${err.response?.data?.detail||"Could not inspect file."}`});
    }finally{setInspecting(false);}
  }

  async function detectColumns(dists,campMap,uploadPath){
    setColDetection(null);resetPreview();setDetecting(true);
    try{
      const fd=new FormData();
      fd.append("slide_type",selectedType);
      fd.append("upload_path",uploadPath||inspection.upload_path);
      fd.append("selected_districts",JSON.stringify(dists));
      fd.append("selected_campuses",JSON.stringify(campMap));
      fd.append("aggregation_level",aggLevel);
      const r=await axios.post(`${API}/detect-columns`,fd);
      setColDetection(r.data);
      const init={};
      for(const fld of r.data.fields)if(fld.detected)init[fld.key]=fld.detected;
      setColOverrides(init);
    }catch(err){
      setStatus({type:"error",msg:`✗ ${err.response?.data?.detail||"Column detection failed."}`});
    }finally{setDetecting(false);}
  }

  function toggleDistrict(sname){
    const isSel=selectedDistricts.includes(sname);
    const newD=isSel?selectedDistricts.filter(d=>d!==sname):[...selectedDistricts,sname];
    const newC={...selectedCampuses};
    if(isSel)delete newC[sname]; else newC[sname]=[];
    setSelectedDistricts(newD);setSelectedCampuses(newC);
    // Auto-expand campus picker when selecting a district in campus view
    if(!isSel && aggLevel==="campus") setExpandedDistricts(p=>({...p,[sname]:true}));
    if(newD.length>0) detectColumns(newD,newC,inspection.upload_path);
    else{setColDetection(null);resetPreview();}
  }
  function toggleCampus(sname,campus){
    const cur=selectedCampuses[sname]||[];
    const isSel=cur.includes(campus);
    const newList=isSel?cur.filter(c=>c!==campus):[...cur,campus];
    const newC={...selectedCampuses,[sname]:newList};
    setSelectedCampuses(newC);
    const newD=selectedDistricts.includes(sname)?selectedDistricts:[...selectedDistricts,sname];
    setSelectedDistricts(newD);
    detectColumns(newD,newC,inspection.upload_path);
  }
  function selectAllDistricts(){
    const usable=(inspection?.districts||[]).filter(d=>d.usable);
    const newD=usable.map(d=>d.sheet_name);
    const newC=Object.fromEntries(usable.map(d=>[d.sheet_name,[]]));
    setSelectedDistricts(newD);setSelectedCampuses(newC);
    detectColumns(newD,newC,inspection.upload_path);
  }
  function selectAllCampuses(sname,campuses){
    const newC={...selectedCampuses,[sname]:campuses};
    setSelectedCampuses(newC);
    const newD=selectedDistricts.includes(sname)?selectedDistricts:[...selectedDistricts,sname];
    setSelectedDistricts(newD);
    detectColumns(newD,newC,inspection.upload_path);
  }

  // ── Preview ─────────────────────────────────────────────────────────────
  async function handlePreview(){
    setPreviewing(true);
    setStatus({type:"loading",msg:"Calculating preview…"});
    await new Promise(r => setTimeout(r, 30));
    try{
      const fd=new FormData();
      fd.append("slide_type",selectedType);
      if(inspection?.upload_path) fd.append("upload_path",inspection.upload_path);
      fd.append("selected_districts",JSON.stringify(selectedDistricts));
      fd.append("selected_campuses",JSON.stringify(selectedCampuses));
      fd.append("overrides",JSON.stringify(buildOverrides()));
      fd.append("manual_text",JSON.stringify({...manualText, footnote: composeFootnote()}));
      fd.append("mode",mode);fd.append("aggregation_level",aggLevel);
      const r=await axios.post(`${API}/preview-slide`,fd);
      setPreview(r.data);
      setEditLabels({...r.data.slide_data});
      setEditSeries((r.data.chart_data?.series||[]).map(s=>({...s,values:[...s.values]})));
      setEditCategories([...(r.data.chart_data?.categories||[])]);
      setEditInsights(r.data.insights||[]);
      setStatus({type:"",msg:""});
    }catch(err){
      const msg=err.response?.data?.detail?.error||err.response?.data?.detail||"Preview failed.";
      setStatus({type:"error",msg:`✗ ${err?.message || msg}`});
    }finally{setPreviewing(false);}
  }

  async function askClaudeAboutData(){
    const q = claudeQuestion.trim();
    if(!q){
      setClaudeError("Type a question first.");
      return;
    }
    if(!inspection?.upload_path){
      setClaudeError("Upload and select a dataset before asking Claude.");
      return;
    }
    setClaudeAsking(true);
    setClaudeError("");
    setClaudeAnswer("");
    try{
      const fd = new FormData();
      fd.append("slide_type", selectedType);
      fd.append("upload_path", inspection.upload_path);
      fd.append("selected_districts", JSON.stringify(selectedDistricts));
      fd.append("selected_campuses", JSON.stringify(selectedCampuses));
      fd.append("overrides", JSON.stringify(buildOverrides()));
      fd.append("manual_text", JSON.stringify({...manualText, footnote: composeFootnote()}));
      fd.append("mode", mode);
      fd.append("aggregation_level", aggLevel);
      fd.append("question", q);
      const r = await axios.post(`${API}/ask-claude-data`, fd, {timeout:90000});
      setClaudeAnswer(r.data?.answer || "Claude returned an empty answer.");
    }catch(err){
      const detail = err.response?.data?.detail || "Claude request failed.";
      setClaudeError(typeof detail === "string" ? detail : JSON.stringify(detail));
    }finally{
      setClaudeAsking(false);
    }
  }

  // ── Generate single slide ─────────────────────────────────────────────────
  // Fetch the full rendered HTML for the slide preview iframe
  async function fetchSlidePreviewHtml(){
    if(!preview) return;
    setFetchingPreview(true);
    try{
      const fd=new FormData();
      fd.append("slide_type", selectedType||"");
      fd.append("mode", mode);
      fd.append("insights_json",  JSON.stringify(editInsights));
      fd.append("slide_data_json",JSON.stringify({...preview.slide_data,...editLabels}));
      fd.append("chart_data_json",JSON.stringify({...preview.chart_data,series:editSeries,categories:editCategories}));
      fd.append("manual_map_json",JSON.stringify(manualText));
      const r=await axios.post(`${API}/preview-slide-html`,fd);
      setSlidePreviewHtml(r.data);
      setShowSlidePreview(true);
    }catch(e){console.error("Slide preview error",e);}
    finally{setFetchingPreview(false);}
  }

  async function handleGenerate(){
    setGenerating(true);
    setStatus({type:"loading",msg:"Generating slide…"});
    await new Promise(r => setTimeout(r, 30));
    try{
      const fd=new FormData();
      fd.append("slide_type",selectedType);
      if(inspection?.upload_path) fd.append("upload_path",inspection.upload_path);
      fd.append("selected_districts",JSON.stringify(selectedDistricts));
      fd.append("selected_campuses",JSON.stringify(selectedCampuses));
      fd.append("overrides",JSON.stringify(buildOverrides()));
      fd.append("manual_text",JSON.stringify({...manualText, footnote: composeFootnote()}));
      fd.append("mode",mode);fd.append("aggregation_level",aggLevel);
      if(preview){
        fd.append("preview_slide_data",JSON.stringify(editLabels));
        fd.append("preview_chart_data",JSON.stringify({...preview.chart_data,categories:editCategories,series:editSeries}));
        fd.append("preview_insights",JSON.stringify(editInsights));
      }
      const r=await axios.post(`${API}/generate-slide`,fd,{responseType:"blob",timeout:90000});
      const disp=r.headers["content-disposition"]||"";
      const match=disp.match(/filename="?([^";\n]+)"?/);
      const fname=match?match[1]:`${selectedType}.html`;
      const blob=new Blob([r.data],{type:"text/html"});
      const url=window.URL.createObjectURL(blob);
      const a=Object.assign(document.createElement("a"),{href:url,download:fname});
      document.body.appendChild(a);a.click();a.remove();
      window.open(url,"_blank");
      setStatus({type:"success",msg:`✓ Slide opened in new tab — Ctrl+P to save as PDF.`});
    }catch(err){
      let msg="Generation failed.";
      if(err.response){try{const p=JSON.parse(await err.response.data.text());msg=p?.detail?.error||p?.detail||msg;}catch{msg=`Server error (${err.response.status})`;}}
      setStatus({type:"error",msg:`✗ ${msg}`});
    }finally{setGenerating(false);}
  }

  async function handleGeneratePptx(){
    setGenerating(true);
    setStatus({type:"loading",msg:"Generating editable PowerPoint slide…"});
    await new Promise(r => setTimeout(r, 30));
    try{
      const fd=new FormData();
      fd.append("slide_type",selectedType);
      if(inspection?.upload_path) fd.append("upload_path",inspection.upload_path);
      fd.append("selected_districts",JSON.stringify(selectedDistricts));
      fd.append("selected_campuses",JSON.stringify(selectedCampuses));
      fd.append("overrides",JSON.stringify(buildOverrides()));
      fd.append("manual_text",JSON.stringify({...manualText, footnote: composeFootnote()}));
      fd.append("mode",mode);fd.append("aggregation_level",aggLevel);
      if(preview){
        fd.append("preview_slide_data",JSON.stringify(editLabels));
        fd.append("preview_chart_data",JSON.stringify({...preview.chart_data,categories:editCategories,series:editSeries}));
        fd.append("preview_insights",JSON.stringify(editInsights));
      }
      const r=await axios.post(`${API}/generate-slide-pptx`,fd,{responseType:"blob",timeout:90000});
      const disp=r.headers["content-disposition"]||"";
      const match=disp.match(/filename="?([^";\n]+)"?/);
      const fname=match?match[1]:`${selectedType}.pptx`;
      downloadBlob(r.data, fname, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      setStatus({type:"success",msg:`✓ Editable PowerPoint slide downloaded.`});
    }catch(err){
      let msg="PowerPoint generation failed.";
      if(err.response){try{const p=JSON.parse(await err.response.data.text());msg=p?.detail?.error||p?.detail||msg;}catch{msg=`Server error (${err.response.status})`;}}
      setStatus({type:"error",msg:`✗ ${msg}`});
    }finally{setGenerating(false);}
  }

  // ── Approve slide for presentation ────────────────────────────────────────
  function approveCurrentSlide(){
    const config = {
      slide_type: selectedType, slide_data: editLabels,
      chart_data: {...(preview?.chart_data||{}), categories: editCategories, series: editSeries},
      mode, layout: SLIDE_INFO[selectedType]?.layout||selectedType,
      insights: editInsights, month: manualText.month||"",
      year_label: manualText.year_label||"", footnote: composeFootnote(),
      logo_size: "large",
    };
    setPresSlides(prev=>{
      const updated=[...prev];
      updated[presCurrentIdx]={...updated[presCurrentIdx],status:"approved",config};
      return updated;
    });
    // ── Cache dataset for next slide ──
    if(needsData && inspection?.upload_path){
      setPresFileCache({upload_path:inspection.upload_path, inspection,
                        selectedDistricts, selectedCampuses,
                        fileName: file?.name||"previous file"});
    }
    // ── Cache metadata for next slide (ensure ref is current) ──
    const sharedMetaKeys=["District","month","year_label","data_source","as_of_date","footnote"];
    sharedMetaKeys.forEach(k=>{ if(manualText[k]) presMetaCacheRef.current[k]=manualText[k]; });
    setPresMetaCache({...presMetaCacheRef.current});
    advancePresentation();
  }
  function skipCurrentSlide(){
    setPresSlides(prev=>{const u=[...prev];u[presCurrentIdx]={...u[presCurrentIdx],status:"skipped"};return u;});
    advancePresentation();
  }

  // ── Save current form state into per-slide cache ─────────────────────────
  function saveCurrentSlideState(){
    presSlideStateCache.current[presCurrentIdx] = {
      file, inspection, selectedDistricts:[...selectedDistricts],
      selectedCampuses:{...selectedCampuses}, colOverrides:{...colOverrides},
      manualVals:{...manualVals}, colDetection,
      manualText:{...manualText}, preview,
      editLabels:{...editLabels},
      editSeries:editSeries.map(s=>({...s,values:[...s.values]})),
      editCategories:[...editCategories], editInsights:[...editInsights],
      uploadConfirmed, mode, aggLevel,
    };
  }

  // ── Restore form state from per-slide cache ───────────────────────────────
  function restoreSlideState(idx){
    const snap = presSlideStateCache.current[idx];
    if(!snap) return false;
    setFile(snap.file);
    setInspection(snap.inspection);
    setSelectedDistricts(snap.selectedDistricts);
    setSelectedCampuses(snap.selectedCampuses);
    setColOverrides(snap.colOverrides);
    setManualVals(snap.manualVals);
    setColDetection(snap.colDetection);
    setManualText(snap.manualText);
    setPreview(snap.preview);
    setEditLabels(snap.editLabels);
    setEditSeries(snap.editSeries);
    setEditCategories(snap.editCategories);
    setEditInsights(snap.editInsights);
    setUploadConfirmed(snap.uploadConfirmed);
    setMode(snap.mode);
    setAggLevel(snap.aggLevel);
    setFileError(""); setStatus({type:"",msg:""});
    return true;
  }

  function advancePresentation(){
    saveCurrentSlideState();
    const nextIdx=presCurrentIdx+1;
    if(nextIdx>=presSlides.length){
      setPresPhase("done");
    }else{
      setPresCurrentIdx(nextIdx);
      // Try to restore cached state; otherwise load fresh
      if(!restoreSlideState(nextIdx)){
        selectSlideType(presSlides[nextIdx].slide_type);
      } else {
        // Still need slide fields for the new type
        selectSlideType(presSlides[nextIdx].slide_type);
      }
    }
  }

  // ── Jump back to any previously visited slide ────────────────────────────
  function navigateToSlide(idx){
    if(idx===presCurrentIdx) return;
    saveCurrentSlideState();
    setPresCurrentIdx(idx);
    if(!restoreSlideState(idx)){
      resetSlideState();
      selectSlideType(presSlides[idx].slide_type);
    } else {
      selectSlideType(presSlides[idx].slide_type);
    }
  }

  function downloadBlob(data, fileName, mimeType){
    const blob = new Blob([data], {type:mimeType});
    const url = window.URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {href:url, download:fileName});
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>window.URL.revokeObjectURL(url), 30000);
    return url;
  }

  async function handlePresentationFiles(e){
    const files = Array.from(e.target.files || []);
    if(!files.length) return;
    setPresBatchInspecting(true);
    setStatus({type:"loading",msg:`Uploading ${files.length} presentation data file${files.length!==1?"s":""}…`});
    const uploaded=[];
    for(const f of files){
      const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      try{
        const firstDataSlide = presSlides.find(s => (SLIDE_INFO[s.slide_type]?.needsData !== false));
        const fd = new FormData();
        fd.append("slide_type", firstDataSlide?.slide_type || "district_profile");
        fd.append("file", f);
        const r = await axios.post(`${API}/inspect-file`, fd, {timeout:90000});
        uploaded.push({id,name:f.name,size:f.size,upload_path:r.data.upload_path,inspection:r.data,error:""});
      }catch(err){
        uploaded.push({id,name:f.name,size:f.size,upload_path:"",inspection:null,error:err.response?.data?.detail||"Could not upload/inspect this file."});
      }
    }
    setPresBatchFiles(prev=>[...prev,...uploaded]);
    setPresFileAssignments(prev=>{
      const next={...prev};
      const firstGood = uploaded.find(x=>x.upload_path) || presBatchFiles.find(x=>x.upload_path);
      if(firstGood){
        presSlides.forEach((sl,i)=>{
          if(SLIDE_INFO[sl.slide_type]?.needsData !== false && !next[i]) next[i]=firstGood.upload_path;
        });
      }
      return next;
    });
    setStatus({type:uploaded.some(x=>x.error)?"error":"success",msg:uploaded.some(x=>x.error)?"Some files could not be inspected. You can still use the files that uploaded successfully.":`✓ Uploaded ${uploaded.length} file${uploaded.length!==1?"s":""}.`});
    setPresBatchInspecting(false);
    if(presBatchFileRef.current) presBatchFileRef.current.value="";
  }

  function removePresentationFile(uploadPath){
    setPresBatchFiles(prev=>prev.filter(f=>f.upload_path!==uploadPath));
    setPresFileAssignments(prev=>{
      const next={...prev};
      Object.keys(next).forEach(k=>{ if(next[k]===uploadPath) delete next[k]; });
      return next;
    });
  }

  function buildAutoPresentationPayload(){
    const firstFile = presBatchFiles.find(f=>f.upload_path)?.upload_path || "";
    return presSlides.map((s,i)=>{
      const needs = SLIDE_INFO[s.slide_type]?.needsData !== false;
      const uploadPath = needs ? (presFileAssignments[i] || firstFile) : "";
      const fileInfo = presBatchFiles.find(f => f.upload_path === uploadPath);
      const usableSheets = (fileInfo?.inspection?.districts || []).filter(d => d.usable).map(d => d.sheet_name);
      return {
        slide_type:s.slide_type,
        upload_path:uploadPath,
        selected_districts: usableSheets.length ? usableSheets : undefined,
        selected_campuses:{},
        manual_text:{
          District:(presQuickMeta.District||""),
          meeting_type:(presQuickMeta.meeting_type||""),
          subtitle:(presQuickMeta.subtitle||""),
          month:presQuickMeta.month,
          year_label:presQuickMeta.year_label,
          data_source:presQuickMeta.data_source,
          as_of_date:presQuickMeta.as_of_date,
          footnote:presQuickMeta.footnote
        },
        mode:s.slide_type==="hb3_funds" ? "count" : "percent",
        aggregation_level:SLIDE_INFO[s.slide_type]?.default_agg || undefined,
      };
    });
  }

  function validateAutoPresentationPayload(plan){
    const missing=[];
    plan.forEach((p,i)=>{
      const needs = SLIDE_INFO[p.slide_type]?.needsData !== false;
      if(needs && !p.upload_path) missing.push(`${i+1}. ${SLIDE_INFO[p.slide_type]?.name||p.slide_type}`);
    });
    if(plan.some(p=>p.slide_type==="cover")){
      const missingIntro=[];
      if(!String(presQuickMeta.District||"").trim()) missingIntro.push("District / title");
      if(!String(presQuickMeta.meeting_type||"").trim()) missingIntro.push("Meeting type");
      if(!String(presQuickMeta.month||"").trim()) missingIntro.push("Month");
      if(!String(presQuickMeta.year_label||"").trim()) missingIntro.push("Year");
      if(missingIntro.length) missing.push(`Cover Slide info: ${missingIntro.join(", ")}`);
    }
    return missing;
  }

  function submitQuickPresentationForm(kind, plan){
    const endpoint = kind === "pptx" ? "generate-presentation-pptx-auto" : "generate-presentation-auto";
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `${API}/${endpoint}`;
    form.target = "_blank";
    form.style.display = "none";

    const payloadInput = document.createElement("input");
    payloadInput.type = "hidden";
    payloadInput.name = "payload";
    payloadInput.value = JSON.stringify(plan);
    form.appendChild(payloadInput);

    const autoInput = document.createElement("input");
    autoInput.type = "hidden";
    autoInput.name = "auto_inserts";
    autoInput.value = "true";
    form.appendChild(autoInput);

    document.body.appendChild(form);
    form.submit();
    setTimeout(()=>form.remove(), 1500);
  }

  async function quickGeneratePresentation(kind, event){
    if(event){
      event.preventDefault();
      event.stopPropagation();
    }
    setStatus({type:"loading",msg:kind==="pptx"?"Starting full PowerPoint generation…":"Starting full HTML generation…"});
    if(!presSlides.length){setStatus({type:"error",msg:"Select at least one slide first."});return;}
    const plan = buildAutoPresentationPayload();
    const missing = validateAutoPresentationPayload(plan);
    if(missing.length){
      setStatus({type:"error",msg:`Upload/assign data files before quick generation. Missing file for: ${missing.join(", ")}`});
      return;
    }
    try{
      setQuickBuilding(kind);
      submitQuickPresentationForm(kind, plan);
      setStatus({
        type:"success",
        msg:kind==="pptx"
          ? "✓ PowerPoint generation started in a new browser tab. If it does not download, check the new tab for the backend error."
          : "✓ HTML generation started in a new browser tab. If the deck does not open, check the new tab for the backend error."
      });
      setTimeout(()=>setQuickBuilding(""), 1800);
    }catch(err){
      setQuickBuilding("");
      setStatus({type:"error",msg:`✗ Could not start ${kind==="pptx"?"PowerPoint":"HTML"} generation: ${err?.message || err}`});
    }
  }

  // ── Build presentation ────────────────────────────────────────────────────
  async function buildPresentation(){
    setBuildingPres(true);
    setStatus({type:"loading",msg:"Building presentation…"});
    await new Promise(r => setTimeout(r, 30));
    try{
      const approved=presSlides.filter(s=>s.status==="approved"&&s.config);
      if(!approved.length){setStatus({type:"error",msg:"No approved slides."});return;}
      const payload=JSON.stringify(approved.map(s=>s.config));
      const fd=new FormData();fd.append("payload",payload);
      const r=await axios.post(`${API}/generate-presentation`,fd,{responseType:"blob",timeout:120000});
      const url=window.URL.createObjectURL(new Blob([r.data],{type:"text/html"}));
      const a=Object.assign(document.createElement("a"),{href:url,download:"EMC_Presentation.html"});
      document.body.appendChild(a);a.click();a.remove();
      window.open(url,"_blank");
      setStatus({type:"success",msg:`✓ Presentation downloaded (${approved.length} slides). Opens in browser — Ctrl+P to export PDF.`});
    }catch(err){
      setStatus({type:"error",msg:`✗ Build failed.`});
    }finally{setBuildingPres(false);}
  }

  async function buildPresentationPptx(){
    setBuildingPptx(true);
    setStatus({type:"loading",msg:"Building editable PowerPoint…"});
    await new Promise(r => setTimeout(r, 30));
    try{
      const approved=presSlides.filter(s=>s.status==="approved"&&s.config);
      if(!approved.length){setStatus({type:"error",msg:"No approved slides."});return;}
      const payload=JSON.stringify(approved.map(s=>s.config));
      const fd=new FormData();fd.append("payload",payload);
      const r=await axios.post(`${API}/generate-presentation-pptx`,fd,{responseType:"blob",timeout:120000});
      downloadBlob(r.data, "EMC_Presentation_Editable.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      setStatus({type:"success",msg:`✓ Editable PowerPoint downloaded (${approved.length} approved slides).`});
    }catch(err){
      setStatus({type:"error",msg:`✗ Editable PowerPoint build failed.`});
    }finally{setBuildingPptx(false);}
  }

  function buildOverrides(){
    return Object.fromEntries(Object.entries(colOverrides).map(([k,v])=>[k,v===MANUAL?"":v]));
  }

  // Change 12: Compose the footnote from source + date + any extra note
  function composeFootnote(){
    const src = (manualText.data_source||"")
      .split(",")
      .map(s=>s.trim())
      .filter(s=>s && s !== "__other__")
      .join(", ");
    const dt  = (manualText.as_of_date||todayISO()).trim();
    const extra = (manualText.footnote||"").trim();
    let base = src && dt ? `Source: ${src} as of ${dt}` : src ? `Source: ${src}` : dt ? `As of ${dt}` : "";
    return base && extra ? `${base} · ${extra}` : base || extra;
  }

  function updateManualField(key, value){
    setManualText(p=>({...p,[key]:value}));
    if(appMode==="presentation"){
      presMetaCacheRef.current = {...presMetaCacheRef.current,[key]:value};
      setPresMetaCache({...presMetaCacheRef.current});
    }
    resetPreview();
  }

  function renderMetadataField(f){
    const value = manualText[f.key] || "";
    const requiredValue = f.key === "data_source"
      ? value.split(",").map(s=>s.trim()).filter(s=>s && s !== "__other__").join(", ")
      : (value || (f.key === "as_of_date" ? todayISO() : ""));
    const requiredMissing = f.required && !requiredValue.trim();

    const selectStyle = {borderColor: requiredMissing ? "#FCA5A5" : ""};

    if(f.key === "District"){
      const isOther = value && !DISTRICT_OPTIONS.includes(value);
      return (
        <>
          <select className="text-input" style={selectStyle} value={isOther ? "__other__" : value}
            onChange={e=>updateManualField("District", e.target.value)}>
            <option value="">Select district/campus…</option>
            {DISTRICT_OPTIONS.map(opt=><option key={opt} value={opt}>{opt}</option>)}
            <option value="__other__">Other…</option>
          </select>
          {isOther || value === "" ? null : null}
          {(isOther || value === "__other__") && (
            <input type="text" className="text-input" style={{marginTop:8}} placeholder="Type district/campus name…"
              value={isOther && value !== "__other__" ? value : ""} onChange={e=>updateManualField("District", e.target.value)} />
          )}
        </>
      );
    }

    if(f.key === "month"){
      const isOther = value && !MONTH_OPTIONS.includes(value);
      return (
        <>
          <select className="text-input" value={isOther ? "__other__" : value}
            onChange={e=>updateManualField("month", e.target.value)}>
            <option value="">Select month…</option>
            {MONTH_OPTIONS.map(opt=><option key={opt} value={opt}>{opt}</option>)}
            <option value="__other__">Other…</option>
          </select>
          {(isOther || value === "__other__") && (
            <input type="text" className="text-input" style={{marginTop:8}} placeholder="Type month…"
              value={isOther && value !== "__other__" ? value : ""} onChange={e=>updateManualField("month", e.target.value)} />
          )}
        </>
      );
    }

    if(f.key === "year_label"){
      const isOther = value && !YEAR_OPTIONS.includes(value);
      return (
        <>
          <select className="text-input" value={isOther ? "__other__" : value}
            onChange={e=>updateManualField("year_label", e.target.value)}>
            <option value="">Select year…</option>
            {YEAR_OPTIONS.map(opt=><option key={opt} value={opt}>{opt}</option>)}
            <option value="__other__">Other…</option>
          </select>
          {(isOther || value === "__other__") && (
            <input type="text" className="text-input" style={{marginTop:8}} placeholder="Type year…"
              value={isOther && value !== "__other__" ? value : ""} onChange={e=>updateManualField("year_label", e.target.value)} />
          )}
        </>
      );
    }

    if(f.key === "data_source"){
      const selected = value ? value.split(",").map(s=>s.trim()).filter(Boolean) : [];
      const selectedKnown = selected.filter(s=>SOURCE_OPTIONS.includes(s));
      const otherValue = selected.find(s=>!SOURCE_OPTIONS.includes(s) && s !== "__other__") || "";
      const otherSelected = selected.includes("__other__") || !!otherValue;

      const commitSources = (known, otherOpen, otherText) => {
        const next = [...known];
        if(otherText && otherText.trim()) next.push(otherText.trim());
        else if(otherOpen) next.push("__other__");
        updateManualField("data_source", next.join(", "));
      };

      const toggleSource = (opt, checked) => {
        const nextKnown = checked
          ? Array.from(new Set([...selectedKnown, opt]))
          : selectedKnown.filter(s=>s!==opt);
        commitSources(nextKnown, otherSelected, otherValue);
      };

      const toggleOther = (checked) => {
        commitSources(selectedKnown, checked, checked ? otherValue : "");
      };

      const setOtherSource = (other) => {
        commitSources(selectedKnown, true, other);
      };

      return (
        <div style={{
          border:`1px solid ${requiredMissing ? "#FCA5A5" : "#D1D5DB"}`,
          borderRadius:6,
          padding:"8px 10px",
          background:"#fff",
          maxHeight:128,
          overflowY:"auto"
        }}>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {SOURCE_OPTIONS.map(opt=>(
              <label key={opt} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#374151"}}>
                <input type="checkbox" checked={selectedKnown.includes(opt)} onChange={e=>toggleSource(opt,e.target.checked)} />
                <span>{opt}</span>
              </label>
            ))}
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#374151"}}>
              <input type="checkbox" checked={otherSelected} onChange={e=>toggleOther(e.target.checked)} />
              <span>Other…</span>
            </label>
          </div>
          {otherSelected && (
            <input type="text" className="text-input" style={{marginTop:8}} placeholder="Type other source…"
              value={otherValue} onChange={e=>setOtherSource(e.target.value)} />
          )}
        </div>
      );
    }

    if(f.key === "as_of_date"){
      return (
        <input type="date" className="text-input" style={selectStyle}
          value={value || todayISO()}
          onChange={e=>updateManualField("as_of_date", e.target.value)} />
      );
    }

    return (
      <input type="text" className="text-input"
        style={selectStyle}
        placeholder={f.placeholder}
        value={value}
        onChange={e=>updateManualField(f.key, e.target.value)} />
    );
  }

    const FULLY_STATIC_TYPES = ["cover","mission","methodology","section_divider","agenda","outro"];
  // ── Derived ───────────────────────────────────────────────────────────────
  const usableDistricts=(inspection?.districts||[]).filter(d=>d.usable);
  const hardMissing=(colDetection?.fields||[]).filter(f=>!f.optional&&!colOverrides[f.key]);
  const canPreview=!needsData||( !!colDetection&&hardMissing.length===0&&!detecting&&selectedDistricts.length>0);
  const canGenerate=canPreview&&!!preview&&!generating;
  const allSlides=Object.values(categoryMenu).flat();
  const curPresSlide=presSlides[presCurrentIdx];

  if(showLanding){
    return (
      <div
        className="emc-landing-page"
        onClick={()=>setShowLanding(false)}
        onKeyDown={e=>{ if(e.key === "Enter" || e.key === " ") setShowLanding(false); }}
        role="button"
        tabIndex={0}
        aria-label="Enter EMC Slide Generator"
        style={{
          minHeight:"100vh",
          width:"100%",
          background:"radial-gradient(circle at 50% 15%, #111827 0%, #05070B 42%, #02030A 100%)",
          color:"#fff",
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          overflow:"hidden",
          position:"relative",
          cursor:"pointer",
          fontFamily:"Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        }}
      >
        <style>{`
          @keyframes emcWordReveal {
            0% { opacity: 0; transform: translateY(-34px); filter: blur(8px); letter-spacing: .22em; }
            55% { opacity: 1; transform: translateY(5px); filter: blur(0); }
            100% { opacity: 1; transform: translateY(0); filter: blur(0); letter-spacing: .08em; }
          }
          @keyframes emcGlowPulse {
            0%, 100% { text-shadow: 0 0 18px rgba(255,255,255,.15), 0 0 34px rgba(0,176,240,.18); }
            50% { text-shadow: 0 0 24px rgba(255,255,255,.35), 0 0 52px rgba(0,176,240,.45); }
          }
          @keyframes emcLineSweep {
            from { transform: scaleX(0); opacity: .1; }
            to { transform: scaleX(1); opacity: 1; }
          }
          @keyframes emcFloat {
            0%,100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }
          @keyframes emcProgress {
            0% { transform: translateX(-110%); }
            100% { transform: translateX(260%); }
          }
          .emc-landing-word {
            opacity: 0;
            animation: emcWordReveal .9s cubic-bezier(.2,.85,.2,1) forwards, emcGlowPulse 2.6s ease-in-out infinite;
            font-size: clamp(3rem, 8vw, 7.5rem);
            line-height: .95;
            font-weight: 950;
            text-transform: uppercase;
            letter-spacing: .08em;
            text-align: center;
          }
          .emc-landing-word:nth-child(1) { animation-delay: .35s, 1.2s; color: #FFFFFF; }
          .emc-landing-word:nth-child(2) { animation-delay: .95s, 1.7s; color: #00B0F0; }
          .emc-landing-word:nth-child(3) { animation-delay: 1.55s, 2.1s; color: #E8192C; }
          .emc-landing-divider {
            width: min(520px, 78vw);
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,.42), transparent);
            transform-origin: center;
            animation: emcLineSweep .8s ease-out forwards;
            opacity: 0;
          }
          .emc-landing-enter {
            transition: transform .2s ease, background .2s ease, box-shadow .2s ease;
          }
          .emc-landing-page:hover .emc-landing-enter {
            transform: translateY(-2px);
            box-shadow: 0 14px 40px rgba(0,176,240,.25);
          }
        `}</style>

        <div style={{
          position:"absolute",
          inset:"-20%",
          background:"radial-gradient(circle at 20% 10%, rgba(0,176,240,.16), transparent 28%), radial-gradient(circle at 82% 74%, rgba(232,25,44,.15), transparent 30%)",
          pointerEvents:"none"
        }}/>

        <div style={{
          position:"absolute",
          width:"620px",
          height:"620px",
          border:"42px solid rgba(0,176,240,.08)",
          borderRadius:"50%",
          right:"-190px",
          top:"-180px",
          pointerEvents:"none"
        }}/>
        <div style={{
          position:"absolute",
          width:"560px",
          height:"560px",
          border:"36px solid rgba(232,25,44,.07)",
          borderRadius:"50%",
          left:"-220px",
          bottom:"-220px",
          pointerEvents:"none"
        }}/>

        <main style={{
          position:"relative",
          zIndex:1,
          width:"min(980px, 92vw)",
          display:"flex",
          flexDirection:"column",
          alignItems:"center",
          gap:32,
          padding:"48px 20px"
        }}>
          <div style={{
            display:"flex",
            flexDirection:"column",
            alignItems:"center",
            gap:18,
            animation:"emcFloat 4.4s ease-in-out infinite"
          }}>
            <img
              src={emcLandingLogo}
              alt="Economic Mobility Center"
              style={{
                width:"clamp(120px, 14vw, 180px)",
                height:"auto",
                objectFit:"contain",
                filter:"drop-shadow(0 12px 34px rgba(0,176,240,.26))"
              }}
            />
            <div style={{
              fontSize:"clamp(1.5rem, 4vw, 3rem)",
              fontWeight:900,
              lineHeight:1,
              letterSpacing:".03em",
              color:"#00B0F0",
              textAlign:"center"
            }}>
              Slide Generator
            </div>
          </div>

          <div className="emc-landing-divider" style={{animationDelay:".18s"}}/>

          <section aria-label="Let's start building" style={{
            display:"flex",
            flexDirection:"column",
            alignItems:"center",
            gap:22
          }}>
            <div className="emc-landing-word">LET'S</div>
            <div className="emc-landing-word">START</div>
            <div className="emc-landing-word">BUILDING</div>
          </section>

          <div className="emc-landing-divider" style={{animationDelay:"1.9s"}}/>

          <button
            className="emc-landing-enter"
            onClick={e=>{e.stopPropagation();setShowLanding(false);}}
            style={{
              marginTop:4,
              border:"1px solid rgba(0,176,240,.55)",
              background:"linear-gradient(135deg, #003DA5, #00B0F0)",
              color:"#fff",
              borderRadius:999,
              padding:"14px 30px",
              fontSize:15,
              fontWeight:850,
              letterSpacing:".06em",
              textTransform:"uppercase",
              cursor:"pointer"
            }}
          >
            Enter App →
          </button>

          <div style={{
            width:"min(360px, 62vw)",
            height:6,
            borderRadius:999,
            background:"rgba(255,255,255,.14)",
            overflow:"hidden",
            marginTop:4
          }}>
            <div style={{
              width:"40%",
              height:"100%",
              borderRadius:999,
              background:"linear-gradient(90deg, #00B0F0, #E8192C)",
              animation:"emcProgress 2.2s ease-in-out infinite"
            }}/>
          </div>

          <div style={{
            fontSize:13,
            color:"rgba(255,255,255,.68)",
            letterSpacing:".08em",
            textTransform:"uppercase"
          }}>
            Click anywhere to begin
          </div>
        </main>
      </div>
    );
  }

  return(
    <div className="app-shell" style={{minWidth:320,overflowX:"hidden"}}>
      {/* Header */}
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">
            <svg className="brand-icon" viewBox="0 0 32 32" fill="none" style={{width:48,height:48,flexShrink:0}}>
              <rect x="3" y="3" width="26" height="20" rx="2" fill="#003291"/>
              <rect x="7" y="8" width="18" height="2" rx="1" fill="white" fillOpacity=".9"/>
              <rect x="7" y="13" width="12" height="2" rx="1" fill="white" fillOpacity=".6"/>
              <rect x="10" y="23" width="12" height="4" rx="1" fill="#003291"/>
              <rect x="14" y="27" width="4" height="2" rx="1" fill="#003291"/>
            </svg>
            <div>
              <h1 className="brand-title">EMC Slide Generator</h1>
              <p className="brand-subtitle">Automated executive presentation builder</p>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div className="mode-toggle-strip" style={{marginBottom:0}}>
              <button className={`mtab ${appMode==="single"?"active":""}`} onClick={()=>{setAppMode("single");resetSlideState();}}>Single Slide</button>
              <button className={`mtab ${appMode==="presentation"?"active":""}`} onClick={()=>{setAppMode("presentation");resetSlideState();setPresPhase("plan");setPresSlides([]);setPresCurrentIdx(0);}}>Full Presentation</button>
            </div>
          </div>
        </div>
      </header>

      <main className="app-main">
        {connected===null&&retrying&&(
          <div className="alert alert-loading" style={{display:"flex",alignItems:"center",gap:12,background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:6,padding:"14px 18px",color:"#1E40AF"}}>
            <span className="spinner dark" style={{width:16,height:16,flexShrink:0}}/>
            <span>Warming up — this may take up to 60 seconds…</span>
          </div>
        )}
        {connected===false&&(
          <div className="alert alert-error" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <span>Unable to connect to the server. Please try again in a moment.</span>
            <button className="retry-btn" onClick={startConnectionSequence}>Retry</button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* PRESENTATION BUILDER                                                 */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {appMode==="presentation"&&(
          <>
            {/* Phase: Plan */}
            {presPhase==="plan"&&(
              <div className="card">
                <div className="card-header"><Num n="1"/><h2 className="card-title">Choose slides for your presentation</h2></div>
                <p style={{fontSize:13,color:"#6B7280",marginBottom:18}}>Select the slides to include. You can either configure/approve each slide one-by-one, or upload data files here and generate the full presentation immediately without previewing every slide.</p>
                <div className="pres-slide-picker">
                  {Object.entries(categoryMenu).map(([cat,slides])=>(
                    <div key={cat} className="pres-category">
                      <div className="pres-cat-name">{cat}</div>
                      <div className="pres-cat-slides">
                        {slides.map(s=>{
                          const info=SLIDE_INFO[s.slide_type]||{name:s.slide_name,icon:"📄",desc:""};
                          const isChosen=presSlides.some(p=>p.slide_type===s.slide_type);
                          const thumb=SLIDE_THUMB[s.slide_type];
                          return(
                            <label key={s.slide_type} className={`pres-slide-chip ${isChosen?"chosen":""}`}>
                              <input type="checkbox" style={{display:"none"}} checked={isChosen}
                                onChange={e=>{
                                  if(e.target.checked) setPresSlides(prev=>[...prev,{slide_type:s.slide_type,name:info.name,status:"pending",config:null}]);
                                  else setPresSlides(prev=>prev.filter(p=>p.slide_type!==s.slide_type));
                                }}/>
                              {thumb&&<div className="psc-thumb" style={{borderRadius:3,overflow:"hidden",marginBottom:4}}>{thumb}</div>}
                              <span className="psc-icon">{info.icon}</span>
                              <div className="psc-text">
                                <div className="psc-name">{info.name}</div>
                                <div className="psc-desc">{info.desc}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>


                {presSlides.length>0&&(
                  <div style={{marginTop:18,background:"#F8FAFC",border:"1px solid #E5E7EB",borderRadius:10,padding:"16px 18px"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:12}}>
                      <div>
                        <div style={{fontWeight:900,color:"#003291",fontSize:15}}>Quick full-presentation build</div>
                        <div style={{fontSize:12,color:"#6B7280",marginTop:2}}>Upload one or more data files, assign them to selected data slides, then generate the full deck without previewing each slide.</div>
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <input ref={presBatchFileRef} type="file" accept=".xlsx,.xls,.csv" multiple onChange={handlePresentationFiles} style={{display:"none"}}/>
                        <button type="button" className="recalc-btn" onClick={()=>presBatchFileRef.current?.click()} disabled={presBatchInspecting||!!quickBuilding}>
                          {presBatchInspecting?<><span className="spinner dark"/>Uploading…</>:"📁 Upload multiple files"}
                        </button>
                      </div>
                    </div>

                    <div style={{display:"grid",gridTemplateColumns:"repeat(5, minmax(120px, 1fr))",gap:10,marginBottom:12}}>
                      <input className="text-input" placeholder="District / Organization" value={presQuickMeta.District||""} onChange={e=>setPresQuickMeta(p=>({...p,District:e.target.value}))}/>
                      <select className="text-input" value={presQuickMeta.month||""} onChange={e=>setPresQuickMeta(p=>({...p,month:e.target.value}))}>{MONTH_OPTIONS.map(m=><option key={m} value={m}>{m}</option>)}</select>
                      <select className="text-input" value={presQuickMeta.year_label||""} onChange={e=>setPresQuickMeta(p=>({...p,year_label:e.target.value}))}>{YEAR_OPTIONS.map(y=><option key={y} value={y}>{y}</option>)}</select>
                      <input className="text-input" placeholder="Source" value={presQuickMeta.data_source||""} onChange={e=>setPresQuickMeta(p=>({...p,data_source:e.target.value}))}/>
                      <input className="text-input" type="date" value={presQuickMeta.as_of_date||todayISO()} onChange={e=>setPresQuickMeta(p=>({...p,as_of_date:e.target.value}))}/>
                    </div>

                    {presSlides.some(s=>s.slide_type==="cover")&& (
                      <div style={{background:"#FFFFFF",border:"1px solid #BFDBFE",borderRadius:8,padding:"12px 14px",marginBottom:12}}>
                        <div style={{fontWeight:900,fontSize:13,color:"#003291",marginBottom:4}}>Intro / Cover slide information</div>
                        <div style={{fontSize:11,color:"#6B7280",marginBottom:10}}>These fields populate the intro slide when you generate the full presentation now.</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(3, minmax(160px, 1fr))",gap:10}}>
                          <input className="text-input" placeholder="District / title, e.g. GPISD" value={presQuickMeta.District||""} onChange={e=>setPresQuickMeta(p=>({...p,District:e.target.value}))}/>
                          <input className="text-input" placeholder="Meeting type, e.g. Partner Meeting" value={presQuickMeta.meeting_type||""} onChange={e=>setPresQuickMeta(p=>({...p,meeting_type:e.target.value}))}/>
                          <input className="text-input" placeholder="Subtitle, optional" value={presQuickMeta.subtitle||""} onChange={e=>setPresQuickMeta(p=>({...p,subtitle:e.target.value}))}/>
                        </div>
                      </div>
                    )}

                    {presBatchFiles.length>0&&(
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
                        {presBatchFiles.map(f=>(
                          <div key={f.id} style={{display:"flex",alignItems:"center",gap:6,background:f.error?"#FEF2F2":"#EFF6FF",border:`1px solid ${f.error?"#FCA5A5":"#BFDBFE"}`,borderRadius:999,padding:"6px 10px",fontSize:12,color:f.error?"#991B1B":"#1E40AF"}}>
                            <span>{f.error?"⚠":"📊"}</span><span style={{fontWeight:700}}>{f.name}</span>{f.upload_path&&<span style={{color:"#6B7280"}}>({(f.size/1024).toFixed(0)} KB)</span>}
                            {f.error&&<span>{String(f.error).slice(0,90)}</span>}
                            {f.upload_path&&<button type="button" onClick={()=>removePresentationFile(f.upload_path)} style={{border:"none",background:"transparent",color:"#6B7280",cursor:"pointer",fontWeight:900}}>×</button>}
                          </div>
                        ))}
                      </div>
                    )}

                    {presSlides.some(s=>SLIDE_INFO[s.slide_type]?.needsData!==false)&&(
                      <div style={{background:"#FFFFFF",border:"1px solid #E5E7EB",borderRadius:8,padding:"10px 12px",marginBottom:12}}>
                        <div style={{fontWeight:800,fontSize:12,color:"#374151",marginBottom:8}}>Assign data files to selected data slides</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))",gap:8}}>
                          {presSlides.map((s,i)=>{
                            const needs = SLIDE_INFO[s.slide_type]?.needsData !== false;
                            if(!needs) return null;
                            const firstGood = presBatchFiles.find(f=>f.upload_path)?.upload_path || "";
                            const value = presFileAssignments[i] || firstGood;
                            return (
                              <label key={i} style={{fontSize:12,color:"#374151",display:"flex",flexDirection:"column",gap:4}}>
                                <span style={{fontWeight:800}}>{i+1}. {SLIDE_INFO[s.slide_type]?.name||s.slide_type}</span>
                                <select className="text-input" value={value} onChange={e=>setPresFileAssignments(p=>({...p,[i]:e.target.value}))}>
                                  <option value="">Choose data file…</option>
                                  {presBatchFiles.filter(f=>f.upload_path).map(f=><option key={f.upload_path} value={f.upload_path}>{f.name}</option>)}
                                </select>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                      <button type="button" className={`generate-btn ${quickBuilding==="pptx"?"loading":""}`} style={{width:"auto",padding:"11px 20px",background:"#16A34A"}} onClick={(e)=>quickGeneratePresentation("pptx", e)} disabled={presBatchInspecting}>
                        {quickBuilding==="pptx"?<><span className="spinner"/>Generating full PowerPoint…</>:"⬇ Generate Full PowerPoint Now"}
                      </button>
                      <button type="button" className={`generate-btn ${quickBuilding==="html"?"loading":""}`} style={{width:"auto",padding:"11px 20px",background:"#003291"}} onClick={(e)=>quickGeneratePresentation("html", e)} disabled={presBatchInspecting}>
                        {quickBuilding==="html"?<><span className="spinner"/>Generating full HTML…</>:"▶ Generate Full HTML Now"}
                      </button>
                      <div style={{fontSize:11,color:"#6B7280"}}>Or use Start Building to preview and approve slides individually.</div>
                    </div>
                    {quickBuilding&&(
                      <div className="loading-banner" style={{marginTop:12}}>
                        <span className="spinner" style={{width:18,height:18}}/>
                        <div>
                          <div style={{fontWeight:800,fontSize:13}}>{quickBuilding==="pptx"?"Generating full editable PowerPoint…":"Generating full HTML presentation…"}</div>
                          <div style={{fontSize:11,opacity:.85}}>The app is calculating each selected slide from the assigned file automatically. No slide-by-slide preview is required.</div>
                        </div>
                      </div>
                    )}
                    {status.msg&&presPhase==="plan"&&(
                      <div className={`status-message ${status.type}`} style={{marginTop:12}}>{status.msg}</div>
                    )}
                  </div>
                )}

                {presSlides.length>0&&(
                  <div className="pres-plan-footer">
                    <div className="pres-plan-count">{presSlides.length} slide{presSlides.length!==1?"s":""} selected</div>
                    <button className="generate-btn" style={{width:"auto",padding:"12px 28px"}}
                      onClick={()=>{setPresPhase("build");setPresCurrentIdx(0);selectSlideType(presSlides[0].slide_type);}}>
                      Start Building →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Phase: Build */}
            {presPhase==="build"&&curPresSlide&&(
              <>
                {/* Progress bar — clickable steps */}
                <div className="card" style={{padding:"14px 20px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                    <div style={{fontWeight:700,color:"#003291",fontSize:14}}>
                      Building Presentation — Slide {presCurrentIdx+1} of {presSlides.length}: <span style={{color:"#00B0F0"}}>{curPresSlide.name}</span>
                    </div>
                    <button className="link-btn" style={{color:"#E8192C"}} onClick={()=>{saveCurrentSlideState();setPresPhase("plan");}}>← Back to plan</button>
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    {presSlides.map((s,i)=>(
                      <div key={i}
                        onClick={()=>navigateToSlide(i)}
                        title={`${s.name}${s.status==="approved"?" ✓":s.status==="skipped"?" (skipped)":""}`}
                        style={{
                          flex:1, height:8, borderRadius:4, cursor:"pointer",
                          background:s.status==="approved"?"#16A34A":s.status==="skipped"?"#9CA3AF":i===presCurrentIdx?"#00B0F0":"#E5E7EB",
                          outline:i===presCurrentIdx?"2px solid #003291":"none",
                          outlineOffset:1,
                          transition:"all .15s",
                        }}/>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:0,marginTop:6}}>
                    {presSlides.map((s,i)=>(
                      <div key={i}
                        onClick={()=>navigateToSlide(i)}
                        style={{
                          fontSize:9, cursor:"pointer",
                          color:s.status==="approved"?"#16A34A":s.status==="skipped"?"#9CA3AF":i===presCurrentIdx?"#003291":"#9CA3AF",
                          fontWeight:i===presCurrentIdx?700:400,
                          textAlign:"center", flex:1, overflow:"hidden",
                          textOverflow:"ellipsis", whiteSpace:"nowrap",
                          paddingTop:2,
                        }}>{s.name}</div>
                    ))}
                  </div>
                </div>

                {/* Render the single-slide configuration flow */}
                {renderSlideConfig({
                  onApprove: approveCurrentSlide,
                  onSkip: skipCurrentSlide,
                  isPresMode: true,
                })}
              </>
            )}

            {/* Phase: Done */}
            {presPhase==="done"&&(
              <div className="card">
                <div style={{textAlign:"center",padding:"32px 20px"}}>
                  <div style={{fontSize:48,marginBottom:12}}>🎉</div>
                  <div style={{fontSize:22,fontWeight:800,color:"#003291",marginBottom:8}}>All slides configured!</div>
                  <div style={{fontSize:14,color:"#6B7280",marginBottom:24}}>
                    {presSlides.filter(s=>s.status==="approved").length} slides approved · {presSlides.filter(s=>s.status==="skipped").length} skipped
                  </div>
                  <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap",marginBottom:24}}>
                    {presSlides.map((s,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:6,background:s.status==="approved"?"#F0FDF4":"#F9FAFB",border:`1px solid ${s.status==="approved"?"#16A34A":"#E5E7EB"}`,borderRadius:6,padding:"6px 12px",fontSize:12}}>
                        <span>{s.status==="approved"?"✅":"⏭"}</span>
                        <span style={{fontWeight:600}}>{s.name}</span>
                      </div>
                    ))}
                  </div>
                  {/* ── Final slide order review before download ── */}
                  <div style={{marginBottom:20,background:"#F8FAFC",border:"1px solid #E5E7EB",borderRadius:8,padding:"12px 16px"}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#374151",marginBottom:10}}>📋 Review &amp; Reorder Slides Before Generating:</div>
                    {presSlides.map((s,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #F3F4F6"}}>
                        <span style={{color:"#003291",fontWeight:800,fontSize:12,width:22,textAlign:"right",flexShrink:0}}>{i+1}</span>
                        <span style={{fontSize:13,flex:1,color:s.status==="approved"?"#166534":s.status==="skipped"?"#6B7280":"#374151"}}>
                          {SLIDE_INFO[s.slide_type]?.icon||"📄"} {SLIDE_INFO[s.slide_type]?.name||s.slide_type}
                          {s.status==="approved"&&<span style={{fontSize:10,color:"#16A34A",marginLeft:6}}>✓</span>}
                          {s.status==="skipped"&&<span style={{fontSize:10,color:"#9CA3AF",marginLeft:6}}>skipped</span>}
                        </span>
                        <button onClick={()=>{if(i>0){const a=[...presSlides];[a[i-1],a[i]]=[a[i],a[i-1]];setPresSlides(a);}}} disabled={i===0}
                          style={{background:"none",border:"none",cursor:i===0?"not-allowed":"pointer",color:i===0?"#D1D5DB":"#6B7280",fontSize:14,padding:"0 3px"}}>▲</button>
                        <button onClick={()=>{if(i<presSlides.length-1){const a=[...presSlides];[a[i],a[i+1]]=[a[i+1],a[i]];setPresSlides(a);}}} disabled={i===presSlides.length-1}
                          style={{background:"none",border:"none",cursor:i===presSlides.length-1?"not-allowed":"pointer",color:i===presSlides.length-1?"#D1D5DB":"#6B7280",fontSize:14,padding:"0 3px"}}>▼</button>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
                    <button className={`generate-btn ${buildingPres?"loading":""}`} style={{width:"auto",padding:"14px 28px",fontSize:16}} onClick={buildPresentation} disabled={buildingPres||buildingPptx}>
                      {buildingPres?<><span className="spinner"/>Building HTML…</>:"▶ Download HTML Presentation"}
                    </button>
                    <button className={`generate-btn ${buildingPptx?"loading":""}`} style={{width:"auto",padding:"14px 28px",fontSize:16,background:"#16A34A"}} onClick={buildPresentationPptx} disabled={buildingPres||buildingPptx}>
                      {buildingPptx?<><span className="spinner"/>Building PowerPoint…</>:"⬇ Download Editable PowerPoint"}
                    </button>
                  </div>
                  {(buildingPres||buildingPptx)&&(
                    <div className="loading-status" style={{marginTop:8}}>
                      <span className="spinner dark" style={{width:14,height:14}}/>
                      <span>{buildingPptx?"Generating editable PowerPoint with editable charts, shapes, and text…":"Generating all slides and assembling presentation — please wait…"}</span>
                    </div>
                  )}
                  <div style={{marginTop:12}}><button className="link-btn" onClick={()=>{setPresPhase("plan");}}>← Back to plan</button></div>
                  {status.msg&&<div className={`status-message ${status.type}`} style={{marginTop:12}}>{status.msg}</div>}
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SINGLE SLIDE MODE                                                    */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {appMode==="single"&&(
          <>
            {/* Step 1: Select slide type */}
            <div className="card">
              <div className="card-header"><Num n="1"/><h2 className="card-title">Select slide type</h2></div>
              <div className="pres-slide-picker">
                {Object.entries(categoryMenu).map(([cat,slides])=>(
                  <div key={cat} className="pres-category">
                    <div className="pres-cat-name">{cat}</div>
                    <div className="pres-cat-slides">
                      {slides.map(s=>{
                        const info=SLIDE_INFO[s.slide_type]||{name:s.slide_name,icon:"📄",desc:""};
                        const thumb=SLIDE_THUMB[s.slide_type];
                        return(
                          <label key={s.slide_type} className={`pres-slide-chip ${selectedType===s.slide_type?"chosen":""}`} style={{cursor:"pointer"}}
                            onClick={()=>selectSlideType(selectedType===s.slide_type?"":s.slide_type)}>
                            {thumb&&<div className="psc-thumb" style={{borderRadius:3,overflow:"hidden",marginBottom:4}}>{thumb}</div>}
                            <span className="psc-icon">{info.icon}</span>
                            <div className="psc-text">
                              <div className="psc-name">{info.name}</div>
                              <div className="psc-desc">{info.desc}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {selectedType&&slideFields?.fields?.length>0&&(
                <div className="field-notice" style={{marginTop:14}}>
                  <div className="fn-title">📋 Required columns in your data file</div>
                  <table className="fn-table"><thead><tr><th>Column</th><th>Description</th><th></th></tr></thead>
                    <tbody>{slideFields.fields.map(f=>(
                      <tr key={f.key}><td className="fn-col-name">{f.label}</td><td className="fn-col-desc">{f.description}</td>
                        <td>{f.optional?<span className="opt-tag">optional</span>:<span className="req-tag">required</span>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Slide config steps */}
            {selectedType&&renderSlideConfig({onApprove:null,onSkip:null,isPresMode:false})}
          </>
        )}
      </main>
      <footer className="app-footer">EMC Slide Generator · Economic Mobility Center · Internal use only</footer>
    </div>
  );

  // ── Shared slide configuration UI ────────────────────────────────────────
  function renderSlideConfig({onApprove,onSkip,isPresMode}){
    const stepStart = isPresMode ? 1 : 2;
    return(
      <>
        {/* Upload step (only shown when needsData) */}
        {needsData&&!FULLY_STATIC_TYPES.includes(selectedType)&&(
          <div className="card">
            <div className="card-header"><Num n={stepStart}/><h2 className="card-title">Upload data file</h2></div>


            {/* ── Required columns shown BEFORE upload ── */}
            {slideFields?.fields?.length>0&&!inspection&&(
              <div style={{marginBottom:16,background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:6,padding:"12px 16px"}}>
                <div style={{fontWeight:800,fontSize:13,color:"#1E40AF",marginBottom:8}}>📋 Your file needs these columns:</div>
                {slideFields.fields.filter(f=>!f.optional).map(f=>(
                  <div key={f.key} style={{display:"flex",gap:10,padding:"5px 0",borderBottom:"1px solid #DBEAFE",alignItems:"flex-start"}}>
                    <span style={{fontWeight:700,fontSize:12,color:"#003291",width:160,flexShrink:0}}>{f.label.split("→")[0].trim()}</span>
                    <span style={{fontSize:11,color:"#374151"}}>{f.description}</span>
                  </div>
                ))}
                {slideFields.fields.some(f=>f.optional)&&(
                  <div style={{marginTop:6,fontSize:11,color:"#6B7280",fontStyle:"italic"}}>
                    + {slideFields.fields.filter(f=>f.optional).length} optional column(s) for enhanced calculations
                  </div>
                )}
              </div>
            )}
            {/* ── Reuse cached dataset from previous slide ── */}
            {presFileCache&&!inspection&&(
              <div style={{marginBottom:14,background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:6,padding:"12px 16px",display:"flex",alignItems:"center",gap:14}}>
                <span style={{fontSize:20}}>📂</span>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:13,color:"#166534"}}>Reuse previous dataset?</div>
                  <div style={{fontSize:12,color:"#4B5563",marginTop:2}}>{presFileCache.fileName}</div>
                </div>
                <button className="preview-btn" style={{background:"#16A34A",border:"none",padding:"8px 18px",fontSize:13}} onClick={async()=>{
                  const insp = presFileCache.inspection;
                  const dists = presFileCache.selectedDistricts||[];
                  const camps = presFileCache.selectedCampuses||{};
                  setInspection(insp);
                  setFile({name:presFileCache.fileName});
                  setSelectedDistricts(dists);
                  setSelectedCampuses(camps);
                  setUploadConfirmed(true);
                  if(insp?.upload_path && dists.length>0){
                    await detectColumns(dists, camps, insp.upload_path);
                  }
                }}>✓ Use this file</button>
              </div>
            )}
            {/* Pre-upload confirmation */}
            {!uploadConfirmed&&(
              <div className="upload-confirm-box">
                <div className="ucb-icon">⚠️</div>
                <div className="ucb-content">
                  <div className="ucb-title">Before you upload — please confirm:</div>
                  <ul className="ucb-list">
                    <li>Column headers are in <strong>Row 1</strong> of your spreadsheet</li>
                    <li>No merged cells in the header row</li>
                    <li>Data starts in <strong>Row 2</strong></li>
                  </ul>
                  <label className="ucb-check">
                    <input type="checkbox" checked={uploadConfirmed} onChange={handleConfirmUpload}/>
                    <span>I confirm my file follows this format</span>
                  </label>
                </div>
              </div>
            )}

            {uploadConfirmed&&(
              <>
                <div className={`drop-zone ${file?"has-file":""}`} onClick={()=>fileRef.current?.click()}>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{display:"none"}}/>
                  {inspecting?(
                    <div className="drop-ph"><span className="spinner dark"/><span className="drop-text">Reading file…</span></div>
                  ):file?(
                    <div className="drop-info"><span>📊</span><span className="file-name">{file.name}</span>
                      <span className="file-size">({(file.size/1024).toFixed(0)} KB)</span>
                      <button className="clear-file" onClick={e=>{e.stopPropagation();resetSlideState();}}>✕</button>
                    </div>
                  ):(
                    <div className="drop-ph"><span className="drop-icon">⬆</span>
                      <span className="drop-text">Click to browse your data file</span>
                      <span className="drop-hint">Accepts .xlsx · .xls · .csv</span>
                    </div>
                  )}
                </div>
                {fileError&&<div className="file-warn">{fileError}</div>}
                {inspection&&inspection.districts?.some(d=>d.campuses?.length>20)&&(
                  <div className="file-warn" style={{background:"#FFF7ED",borderColor:"#F59E0B",color:"#92400E"}}>
                    ⚠ This file contains {inspection.districts.reduce((s,d)=>s+(d.campuses?.length||0),0)} schools across all tabs.
                    Use the campus picker below to select only the schools you want to display — the chart will only show the first 20 if you don't filter.
                  </div>
                )}

                {/* Data preview */}
                {inspection?.preview_cols?.length>0&&(
                  <div className="data-preview-section">
                    <button className="link-btn" onClick={()=>setShowPreview(v=>!v)} style={{marginBottom:8}}>
                      {showPreview?"▲ Hide data preview":"▼ Show data preview (first 5 rows)"}
                    </button>
                    {showPreview&&(
                      <div className="data-preview-table-wrap">
                        <table className="data-preview-table">
                          <thead><tr>{inspection.preview_cols.map(c=><th key={c}>{c}</th>)}</tr></thead>
                          <tbody>{inspection.preview_rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* District/campus + columns — only when data is needed AND file is uploaded */}
        {needsData&&inspection&&(
          <div className="card">
            <div className="card-header"><Num n={stepStart+1}/><h2 className="card-title">Select data &amp; view level</h2></div>

            {true&&(
              <>
                {/* View level */}
                <div className="agg-section">
                  <div className="field-label" style={{marginBottom:8}}>VIEW LEVEL</div>
                  <div className="mode-toggle-strip">
                    <button className={`mtab ${aggLevel==="district"?"active":""}`} onClick={()=>{setAggLevel("district");resetPreview();}}>🏙 District (aggregate all campuses)</button>
                    <button className={`mtab ${aggLevel==="campus"?"active":""}`} onClick={()=>{setAggLevel("campus");resetPreview();}}>🏫 Campus (each campus separately)</button>
                  </div>
                  <p className="agg-hint">{aggLevel==="district"?"All campuses in each district combined into one result.":"Each campus gets its own bar. Filter by district/campus below."}</p>
                </div>

                {/* District tree */}
                <div className="district-tree">
                  <div className="tree-header">
                    <div>
                      <span className="field-label">DISTRICTS &amp; CAMPUSES</span>
                      <div className="tree-subhead">Select districts to include. Expand to filter individual campuses.</div>
                    </div>
                    {usableDistricts.length>1&&<button className="link-btn" onClick={selectAllDistricts}>Select all ({usableDistricts.length})</button>}
                  </div>
                  <div className="tree-body">
                    {(inspection.districts||[]).map(dist=>{
                      const isSel=selectedDistricts.includes(dist.sheet_name);
                      const campSel=selectedCampuses[dist.sheet_name]||[];
                      const allC=dist.campuses||[];
                      const isExp=!!expandedDistricts[dist.sheet_name];
                      return(
                        <div key={dist.sheet_name} className={`tree-district ${isSel?"selected":""} ${!dist.usable?"disabled":""}`}>
                          <div className="tree-district-row">
                            <label className="tree-dist-check">
                              <input type="checkbox" checked={isSel} disabled={!dist.usable} onChange={()=>toggleDistrict(dist.sheet_name)}/>
                              <span className="tree-dist-name">
                            🏙 <span style={{color:"#003291",fontWeight:800}}>{dist.name}</span>
                            {!dist.usable&&<span className="s-tag" style={{marginLeft:6}}>no data</span>}
                            {dist.usable&&dist.all_required&&<span className="s-tag ok" style={{marginLeft:6}}>✓</span>}
                            {dist.campuses?.length>0&&<span style={{fontSize:10,color:"#6B7280",fontWeight:400,marginLeft:4}}>({dist.campuses.length} campuses)</span>}
                          </span>
                              {isSel&&campSel.length>0&&<span className="campus-filter-badge">{campSel.length} campus{campSel.length!==1?"es":""}</span>}
                              {isSel&&campSel.length===0&&allC.length>0&&<span className="campus-filter-badge all">all {allC.length}</span>}
                            </label>
                            {isSel&&allC.length>1&&aggLevel==="campus"&&(
                              <button className="expand-btn" onClick={()=>setExpandedDistricts(p=>({...p,[dist.sheet_name]:!p[dist.sheet_name]}))}>
                                {isExp?"▲ Hide campuses":"▼ Filter campuses"}
                              </button>
                            )}
                          </div>
                          {isSel&&allC.length>1&&isExp&&aggLevel==="campus"&&(
                            <div className="tree-campus-list">
                              <div className="campus-list-header">
                                <span className="field-label" style={{fontSize:10}}>CAMPUSES IN {dist.name.toUpperCase()}</span>
                                <div className="campus-list-actions">
                                  <button className="link-btn" onClick={()=>selectAllCampuses(dist.sheet_name,allC)}>All ({allC.length})</button>
                                  {campSel.length>0&&<button className="link-btn" style={{color:"#6B7280"}} onClick={()=>{const n={...selectedCampuses,[dist.sheet_name]:[]};setSelectedCampuses(n);detectColumns(selectedDistricts,n,inspection.upload_path);}}>Clear</button>}
                                </div>
                              </div>
                              <div className="campus-chips">
                                {allC.map(campus=>(
                                  <label key={campus} className={`inst-chip campus-chip ${campSel.includes(campus)?"active":""}`}>
                                    <input type="checkbox" style={{display:"none"}} checked={campSel.includes(campus)} onChange={()=>toggleCampus(dist.sheet_name,campus)}/>
                                    {campus}
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {selectedDistricts.length===0&&<div className="tree-empty">Select at least one district to continue.</div>}
                  </div>
                </div>
              </>
            )}

            {detecting&&<div className="inline-spin"><span className="spinner dark"/>Detecting columns…</div>}

            {colDetection&&(
              <div className="mapping-panel">
                <div className={`mp-title ${hardMissing.length?"warn":"ok"}`}>
                  {hardMissing.length?`⚠ ${hardMissing.length} field(s) need mapping:`:"✓ Field Mapping"}
                </div>
                {colDetection.fields.map(field=>(
                  <MapRow key={field.key} field={field} colOverrides={colOverrides} fileColumns={colDetection.file_columns}
                    setColOverrides={setColOverrides} manualVals={manualVals} setManualVals={setManualVals} resetPreview={resetPreview}/>
                ))}
              </div>
            )}
          </div>
        )}


        {/* ── Static slides: pre-built, no inputs needed ── */}
        {(!needsData||canPreview)&&FULLY_STATIC_TYPES.includes(selectedType)&&(
          <div className="card">
            <div className="card-header">
              <Num n={isPresMode?1:stepStart}/>
              <h2 className="card-title">Ready to generate</h2>
            </div>
            <div style={{background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:6,padding:"14px 18px",display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <span style={{fontSize:22}}>✅</span>
              <div>
                <div style={{fontWeight:700,fontSize:13,color:"#1E40AF"}}>This slide is pre-built — no data or settings required.</div>
                <div style={{fontSize:11,color:"#1D4ED8",marginTop:2}}>Click Approve to add it to your presentation and move to the next slide.</div>
              </div>
            </div>
            <div style={{display:"flex",gap:10}}>
              {isPresMode&&(
                <button className="preview-btn" style={{background:"#16A34A",border:"none"}} onClick={()=>{
                  if(onApprove) onApprove();
                }}>✓ Approve — next slide →</button>
              )}
              {isPresMode&&(
                <button className="recalc-btn" onClick={()=>{if(onSkip) onSkip();}}>⏭ Skip</button>
              )}
              {!isPresMode&&(
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <button className={`generate-btn ${generating?"loading":""}`} onClick={handleGenerate} disabled={generating} style={{width:"auto",flex:"1 1 220px"}}>
                    {generating?<><span className="spinner"/>Generating…</>:<>▶ Generate HTML</>}
                  </button>
                  <button className={`generate-btn ${generating?"loading":""}`} onClick={handleGeneratePptx} disabled={generating} style={{width:"auto",flex:"1 1 220px",background:"#16A34A"}}>
                    {generating?<><span className="spinner"/>Generating…</>:<>⬇ Editable PowerPoint</>}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Data slides: full metadata form + preview ── */}
        {(!needsData||canPreview)&&!FULLY_STATIC_TYPES.includes(selectedType)&&(
          <div className="card">
            <div className="card-header">
              <Num n={needsData?(stepStart+2):(isPresMode?1:stepStart)}/>
              <h2 className="card-title">Slide metadata &amp; preview</h2>
            </div>

            {supportsModes.length>1&&(
              <div className="mode-row">
                <span className="mode-label">Values:</span>
                {supportsModes.map(m=>(
                  <button key={m} className={`mode-btn ${mode===m?"active":""}`} onClick={()=>{setMode(m);resetPreview();}}>
                    {m==="count"?"# Count":"% Percent"}
                  </button>
                ))}
              </div>
            )}

            <div className="metadata-grid">
              {(()=>{
                const NO_SOURCE = ["cover","mission","section_divider","agenda","methodology"];
                const COVER_ONLY = ["cover"];
                const allFields = [
                  {key:"District", label:"District/Campus", placeholder:"e.g. Grand Prairie ISD"},
                  {key:"month",       label:"Month",                         placeholder:"e.g. May"},
                  {key:"year_label",  label:"Year",                          placeholder:"e.g. 2025"},
                  ...(!NO_SOURCE.includes(selectedType)?[
                    {key:"data_source",label:"Source",    placeholder:"e.g. TEA CC Solutions",  required:true},
                    {key:"as_of_date", label:"As of Date",placeholder:"e.g. May 15, 2026",       required:true},
                    {key:"footnote",   label:"Additional Notes",placeholder:"Optional footnote…"},
                  ]:[]),
                  ...(COVER_ONLY.includes(selectedType)?[
                    {key:"meeting_type",label:"Meeting Type",placeholder:"e.g. End of Year Partner Meeting"},
                    {key:"subtitle",    label:"Subtitle",   placeholder:"e.g. Aligning Impact"},
                  ]:[]),
                ];
                // Change 13: filter out any backend-returned "Campus" field — it's merged into District/Campus above
                return allFields.filter(f=>f.key.toLowerCase()!=="campus");
              })().map(f=>(
                <div key={f.key} className="field">
                  <label className="field-label" style={{color:f.required?"#E8192C":""}}>
                    {f.label}
                    {f.required&&<span style={{color:"#E8192C",fontSize:9,marginLeft:4}}>REQUIRED</span>}
                  </label>
                  {renderMetadataField(f)}
                </div>
              ))}
            </div>

            {(!manualText.data_source&&!manualText.as_of_date)&&
             !["cover","mission","methodology","section_divider","agenda"].includes(selectedType)&&(
              <div style={{fontSize:11,color:"#D97706",background:"#FFFBEB",border:"1px solid #FCD34D",borderRadius:4,padding:"6px 12px",marginBottom:8}}>
                ⚠ Source and As of Date will appear in the slide footer as "Source: X as of Y."
              </div>
            )}
            {(manualText.data_source||manualText.as_of_date)&&
             !["cover","mission","methodology","section_divider","agenda"].includes(selectedType)&&(
              <div style={{fontSize:11,color:"#374151",background:"#F1F5F9",border:"1px solid #CBD5E1",borderRadius:4,padding:"6px 12px",marginBottom:8}}>
                📄 Footnote will read: <em style={{color:"#003291"}}>
                  "Source: {(manualText.data_source||"").split(",").map(s=>s.trim()).filter(s=>s && s !== "__other__").join(", ")||"—"} as of {manualText.as_of_date||todayISO()}"
                  {manualText.footnote?` · ${manualText.footnote}`:""}
                </em>
              </div>
            )}

            {!preview?(
              <>
                <button
                  className={`preview-btn ${previewing?"loading":""}`}
                  onClick={handlePreview}
                  disabled={previewing}
                  style={{position:"relative"}}
                >
                  {previewing
                    ? <><span className="spinner"/>Generating Preview…</>
                    : <>👁 Calculate Preview</>
                  }
                </button>
                {previewing&&(
                  <div className="loading-banner" style={{
                    marginTop:12,
                    display:"flex",
                    alignItems:"center",
                    gap:12,
                    justifyContent:"center",
                    background:"#EFF6FF",
                    border:"1px solid #BFDBFE",
                    borderRadius:8,
                    padding:"14px 18px",
                    color:"#1E40AF"
                  }}>
                    <span className="spinner dark" style={{width:18,height:18,flexShrink:0}}/>
                    <div style={{textAlign:"left"}}>
                      <div style={{fontWeight:800,fontSize:13}}>Generating preview…</div>
                      <div style={{fontSize:11,opacity:.85}}>Analyzing the selected data, calculating chart values, and generating insights. This may take a few seconds.</div>
                    </div>
                  </div>
                )}
              </>
            ):(
              <div className="preview-panel">
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <div className="preview-notice" style={{margin:0}}>✏️ All values are editable — including the AI-generated insights.</div>
                  <button className={`preview-btn ${fetchingPreview?"loading":""}`} style={{padding:"7px 16px",fontSize:12,display:"flex",alignItems:"center",gap:6}} onClick={fetchSlidePreviewHtml} disabled={fetchingPreview}>
                    {fetchingPreview?<><span className="spinner"/>Rendering…</>:<>🖼 Preview Slide</>}
                  </button>
                </div>
                {fetchingPreview&&(
                  <div className="loading-banner">
                    <span className="spinner" style={{width:18,height:18}}/>
                    <div>
                      <div style={{fontWeight:700,fontSize:13}}>Rendering slide preview…</div>
                      <div style={{fontSize:11,opacity:.8}}>Generating HTML with your chart and branding — this may take a moment…</div>
                    </div>
                  </div>
                )}
                {/* Slide preview iframe modal */}
                {showSlidePreview&&slidePreviewHtml&&(
                  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}}
                    onClick={()=>setShowSlidePreview(false)}>
                    <div style={{background:"white",borderRadius:8,overflow:"hidden",width:"90vw",maxWidth:1100,boxShadow:"0 24px 80px rgba(0,0,0,.5)"}}
                      onClick={e=>e.stopPropagation()}>
                      <div style={{padding:"10px 16px",background:"#003291",color:"white",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <span style={{fontWeight:700,fontSize:13}}>Slide Preview</span>
                        <button onClick={()=>setShowSlidePreview(false)} style={{background:"none",border:"none",color:"white",cursor:"pointer",fontSize:20,lineHeight:1}}>✕</button>
                      </div>
                      <iframe
                        srcDoc={slidePreviewHtml}
                        style={{width:"100%",height:"calc(90vw * 0.5625)",maxHeight:"calc(1100px * 0.5625)",border:"none",display:"block"}}
                        title="Slide Preview"
                      />
                    </div>
                  </div>
                )}

                {editInsights.length>0&&(
                  <div style={{marginBottom:14}}>
                    <div className="ps-title" style={{marginBottom:8}}>💡 AI-Generated Insights <span style={{fontSize:11,fontWeight:400,color:"#6B7280"}}>(click any to edit)</span></div>
                    {editInsights.map((ins,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:6}}>
                        <span style={{color:"#00B0F0",fontWeight:700,marginTop:3}}>▸</span>
                        <input className="text-input" style={{flex:1,fontSize:12}} value={ins}
                          onChange={e=>{const n=[...editInsights];n[i]=e.target.value;setEditInsights(n);}}/>
                        <button style={{background:"none",border:"none",color:"#E8192C",cursor:"pointer",fontSize:14,padding:"2px 6px"}} onClick={()=>setEditInsights(editInsights.filter((_,j)=>j!==i))}>✕</button>
                      </div>
                    ))}
                    <button className="link-btn" style={{fontSize:11}} onClick={()=>setEditInsights([...editInsights,""])}>+ Add insight</button>
                  </div>
                )}

                <div className="ps-title" style={{marginBottom:8}}>Slide Labels</div>
                <div className="prev-labels">
                  {Object.entries(editLabels).filter(([key])=>key.toLowerCase()!=="campus").sort(([a],[b])=>a==="Title"?-1:b==="Title"?1:0).map(([key,val])=>(
                    <div key={key} className="prev-label-row">
                      <span className="prev-lk" style={{fontWeight:key==="Title"?800:600,color:key==="Title"?"#003291":"#6B7280"}}>
                        {key==="Title"?"✏ Slide Title":key==="District"?"District/Campus":key}
                      </span>
                      <input className="text-input pi" value={val}
                        style={{fontWeight:key==="Title"?700:"normal",fontSize:key==="Title"?"14px":"13px"}}
                        onChange={e=>setEditLabels(p=>({...p,[key]:e.target.value}))}/>
                    </div>
                  ))}
                </div>

                {editSeries.length>0&&preview.chart_data?.categories?.length>0&&(
                  <>
                    <div className="ps-title" style={{marginTop:14,marginBottom:6}}>
                      Chart Data
                      <span style={{fontSize:10,fontWeight:400,color:"#6B7280",marginLeft:6}}>(rename, edit values — × removes columns, ✕ removes rows)</span>
                    </div>
                    <div className="ptw">
                      <table className="pt">
                        <thead>
                          <tr>
                            <th style={{minWidth:160}}>Series / Legend</th>
                            {editCategories.map((cat,ci)=>(
                              <th key={ci} style={{whiteSpace:"nowrap"}}>
                                <div style={{display:"flex",alignItems:"center",gap:4}}>
                                  <input className="ni" style={{width:60,fontSize:11}} value={cat}
                                    onChange={e=>{const n=[...editCategories];n[ci]=e.target.value;setEditCategories(n);}}/>
                                  <button title="Remove column" style={{background:"none",border:"none",color:"#E8192C",cursor:"pointer",fontSize:13,padding:"0 2px"}}
                                    onClick={()=>{
                                      setEditCategories(prev=>prev.filter((_,i)=>i!==ci));
                                      setEditSeries(prev=>prev.map(s=>({...s,values:s.values.filter((_,i)=>i!==ci)})));
                                    }}>×</button>
                                </div>
                              </th>
                            ))}
                            {/* Add column button */}
                            <th>
                              <button title="Add column" onClick={()=>{
                                setEditCategories(prev=>[...prev,"New"]);
                                setEditSeries(prev=>prev.map(s=>({...s,values:[...s.values,0]})));
                              }} style={{background:"#003291",color:"white",border:"none",borderRadius:4,cursor:"pointer",fontSize:12,padding:"2px 8px"}}>+ Col</button>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {editSeries.map((sr,si)=>(
                            <tr key={si}>
                              <td style={{display:"flex",alignItems:"center",gap:4}}>
                                <input className="text-input" style={{fontSize:12,padding:"4px 8px",flex:1}} value={sr.name}
                                  onChange={e=>{setEditSeries(prev=>{const c=prev.map(s=>({...s,values:[...s.values]}));c[si]={...c[si],name:e.target.value};return c;})}}/>
                                <button title="Remove row" onClick={()=>setEditSeries(prev=>prev.filter((_,j)=>j!==si))}
                                  style={{background:"none",border:"none",color:"#E8192C",cursor:"pointer",fontSize:13,padding:"0 2px",flexShrink:0}}>✕</button>
                              </td>
                              {sr.values.map((v,vi)=>(<td key={vi}>
                                <input type="number" className="ni" value={v}
                                  onChange={e=>{const n=parseFloat(e.target.value)||0;setEditSeries(prev=>{const c=prev.map(s=>({...s,values:[...s.values]}));c[si].values[vi]=n;return c;});}}/>
                              </td>))}
                              <td/>
                            </tr>
                          ))}
                          {/* Add series row */}
                          <tr>
                            <td colSpan={editCategories.length+2}>
                              <button onClick={()=>setEditSeries(prev=>[...prev,{name:"New Series",values:editCategories.map(()=>0)}])}
                                style={{background:"none",border:"1px dashed #003291",color:"#003291",borderRadius:4,cursor:"pointer",fontSize:12,padding:"4px 12px",width:"100%"}}>
                                + Add row
                              </button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                <div style={{display:"flex",gap:10,marginTop:14,alignItems:"center",flexWrap:"wrap"}}>
                  <button className="recalc-btn" onClick={resetPreview}>↺ Reset</button>
                  <button className="recalc-btn" style={{color:"#003291",borderColor:"#003291"}} onClick={async()=>{
                    try{
                      // Send the EDITED chart data (with user's renamed series) to get updated insights
                      const fd=new FormData();
                      fd.append("slide_type", selectedType||"");
                      fd.append("mode", mode);
                      fd.append("slide_data_json", JSON.stringify({...preview.slide_data,...editLabels}));
                      fd.append("chart_data_json", JSON.stringify({
                        ...preview.chart_data,
                        series: editSeries,       // use edited series names
                        categories: editCategories // use edited category names
                      }));
                      const r=await axios.post(`${API}/generate-insights`, fd);
                      if(r.data?.insights) setEditInsights(r.data.insights);
                    }catch(e){console.error("Regenerate insights error:",e);}
                  }}>🤖 Regenerate Insights</button>
                  <button
                    className="recalc-btn"
                    style={{color:"#003291",borderColor:"#00B0F0",background:"#EFF6FF"}}
                    onClick={()=>setClaudeQuestion(q=>q || "Calculate the TSI Met percent for this loaded dataset.")}
                  >
                    💬 Ask Claude
                  </button>
                  {isPresMode&&(
                    <>
                      <button className="preview-btn" style={{background:"#16A34A",border:"none"}} onClick={onApprove}>✓ Approve — next slide →</button>
                      <button className="recalc-btn" style={{color:"#6B7280"}} onClick={onSkip}>⏭ Skip this slide</button>
                    </>
                  )}
                </div>

                {(claudeQuestion || claudeAnswer || claudeError || claudeAsking) && (
                  <div style={{
                    marginTop:14,
                    border:"1px solid #BFDBFE",
                    background:"#F8FBFF",
                    borderRadius:8,
                    padding:"12px 14px"
                  }}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:8}}>
                      <div style={{fontWeight:800,color:"#003291",fontSize:13}}>💬 Ask Claude about this loaded dataset</div>
                      <button
                        type="button"
                        onClick={()=>{setClaudeQuestion("");setClaudeAnswer("");setClaudeError("");}}
                        style={{background:"none",border:"none",color:"#6B7280",cursor:"pointer",fontSize:16}}
                        title="Close Ask Claude"
                      >
                        ✕
                      </button>
                    </div>
                    <textarea
                      className="text-input"
                      rows={3}
                      placeholder="Ask a data question, e.g. Calculate the TSI Met percent for this loaded dataset."
                      value={claudeQuestion}
                      onChange={e=>setClaudeQuestion(e.target.value)}
                      style={{width:"100%",resize:"vertical",fontSize:12,lineHeight:1.45}}
                    />
                    <div style={{display:"flex",gap:8,alignItems:"center",marginTop:8,flexWrap:"wrap"}}>
                      <button
                        className={`preview-btn ${claudeAsking?"loading":""}`}
                        onClick={askClaudeAboutData}
                        disabled={claudeAsking || !claudeQuestion.trim()}
                        style={{width:"auto",padding:"8px 16px",fontSize:12}}
                      >
                        {claudeAsking ? <><span className="spinner"/>Asking Claude…</> : "Ask Claude"}
                      </button>
                      <button
                        className="link-btn"
                        type="button"
                        onClick={()=>setClaudeQuestion("Calculate the TSI Met percent for this loaded dataset.")}
                        style={{fontSize:11}}
                      >
                        Use example question
                      </button>
                    </div>
                    {claudeAsking && (
                      <div className="loading-banner" style={{marginTop:10}}>
                        <span className="spinner" style={{width:16,height:16}}/>
                        <div>
                          <div style={{fontWeight:700,fontSize:12}}>Claude is reviewing the selected dataset…</div>
                          <div style={{fontSize:11,opacity:.8}}>This can take a few seconds for larger files.</div>
                        </div>
                      </div>
                    )}
                    {claudeError && (
                      <div style={{marginTop:10,color:"#B91C1C",background:"#FEF2F2",border:"1px solid #FCA5A5",borderRadius:6,padding:"8px 10px",fontSize:12}}>
                        {claudeError}
                      </div>
                    )}
                    {claudeAnswer && (
                      <div style={{marginTop:10,color:"#003291",background:"#FFFFFF",border:"1px solid #DBEAFE",borderRadius:6,padding:"10px 12px",fontSize:12,lineHeight:1.5,whiteSpace:"pre-wrap"}}>
                        {claudeAnswer}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step: Review + download (single mode only) */}
        {!isPresMode&&canGenerate&&(
          <div className="card generate-card">
            <div className="card-header"><Num n={stepStart+3}/><h2 className="card-title">Review &amp; download</h2></div>
            <div className="chart-preview-box">
              <div className="ps-title" style={{marginBottom:8}}>Chart Preview</div>
              <ChartPreview chartData={{...preview.chart_data,categories:editCategories,series:editSeries}} mode={mode}/>
            </div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button className={`generate-btn ${generating?"loading":""}`} onClick={handleGenerate} disabled={generating} style={{width:"auto",flex:"1 1 240px"}}>
                {generating?<><span className="spinner"/>Generating slide HTML…</>:<>▶&nbsp;Generate HTML Slide</>}
              </button>
              <button className={`generate-btn ${generating?"loading":""}`} onClick={handleGeneratePptx} disabled={generating} style={{width:"auto",flex:"1 1 240px",background:"#16A34A"}}>
                {generating?<><span className="spinner"/>Generating PowerPoint…</>:<>⬇&nbsp;Download Editable PowerPoint</>}
              </button>
            </div>
            {generating&&(
              <div className="loading-banner">
                <span className="spinner" style={{width:18,height:18}}/>
                <div>
                  <div style={{fontWeight:700,fontSize:13}}>Generating slide…</div>
                  <div style={{fontSize:11,opacity:.8}}>Building slide with chart and branding — downloading when ready…</div>
                </div>
              </div>
            )}
            {status.msg&&<div className={`status-message ${status.type}`}>{status.msg}</div>}
          </div>
        )}

        {status.msg&&appMode==="single"&&!canGenerate&&<div className={`status-message ${status.type}`}>{status.msg}</div>}
      </>
    );
  }
}
