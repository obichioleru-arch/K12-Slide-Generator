import { useEffect, useState, useRef } from "react";
import axios from "axios";
import "./App.css";

const API = "https://k12-slide-generator-api.onrender.com";
const COLORS = ["#0D1B4B","#00B0F0","#E8192C","#FFC000","#C084FC","#6B7280"];
const MANUAL = "__manual__";

// ── Mini chart preview ────────────────────────────────────────────────────────
function ChartPreview({ chartData, mode }) {
  if (!chartData?.series?.length || !chartData?.categories?.length) return null;
  const { categories, series } = chartData;
  const isHBar = series.length === 1;
  const W=480, H=isHBar?Math.max(140,categories.length*38+50):220;
  const pL=isHBar?Math.min(180,Math.max(90,8*Math.max(...categories.map(c=>c.length)))):36;
  const pB=38,pT=12,pR=20,cW=W-pL-pR,cH=H-pT-pB;
  const fmt=v=>mode==="percent"?`${Number(v).toFixed(1)}%`:String(Math.round(Number(v)));
  let maxV=0;
  categories.forEach((_,ci)=>{const s=series.reduce((a,sr)=>a+(Number(sr.values[ci])||0),0);if(s>maxV)maxV=s;});
  maxV=Math.ceil((maxV*1.1)/10)*10||100;

  if(isHBar){
    const barH=Math.min(22,Math.max(10,cH/categories.length-7));
    const gap=(cH-barH*categories.length)/(categories.length+1);
    return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:W,display:"block",margin:"0 auto",overflow:"visible"}}>
      {[0,20,40,60,80,100].filter(v=>v<=maxV).map(v=>{const x=pL+(v/maxV)*cW;return<g key={v}><line x1={x} y1={pT} x2={x} y2={H-pB} stroke="#E5E7EB" strokeWidth="1"/><text x={x} y={H-pB+12} textAnchor="middle" fontSize="9" fill="#9CA3AF">{v}</text></g>;})}
      {categories.map((cat,ci)=>{const val=Number(series[0].values[ci])||0,bw=(val/maxV)*cW,y=pT+gap+ci*(barH+gap);return(<g key={ci}><text x={pL-5} y={y+barH/2+3} textAnchor="end" fontSize="10" fill="#374151">{cat.length>20?cat.slice(0,20)+"…":cat}</text><rect x={pL} y={y} width={Math.max(bw,2)} height={barH} fill={COLORS[0]} rx="2"/>{bw>24&&<text x={pL+bw/2} y={y+barH/2+3} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#fff">{fmt(val)}</text>}</g>);})}
      <line x1={pL} y1={H-pB} x2={W-pR} y2={H-pB} stroke="#D1D5DB"/>
    </svg>);
  }
  const colW=Math.max(12,Math.min(44,cW/categories.length-8)),space=cW/categories.length;
  return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:W,display:"block",margin:"0 auto",overflow:"visible"}}>
    {[0,20,40,60,80,100].filter(v=>v<=maxV).map(v=>{const y=pT+cH-(v/maxV)*cH;return<g key={v}><line x1={pL} y1={y} x2={W-pR} y2={y} stroke="#E5E7EB" strokeWidth="1"/><text x={pL-3} y={y+3} textAnchor="end" fontSize="9" fill="#9CA3AF">{v}</text></g>;})}
    {categories.map((cat,ci)=>{const cx=pL+ci*space+space/2;let base=0;return(<g key={ci}>{series.map((sr,si)=>{const val=Number(sr.values[ci])||0,bh=(val/maxV)*cH,y=pT+cH-(base+val)/maxV*cH;base+=val;return(<g key={si}><rect x={cx-colW/2} y={y} width={colW} height={bh} fill={COLORS[si%COLORS.length]} rx="1"/>{bh>12&&<text x={cx} y={y+bh/2+3} textAnchor="middle" fontSize="8" fontWeight="bold" fill="#fff">{fmt(val)}</text>}</g>);})}<text x={cx} y={H-pB+12} textAnchor="middle" fontSize="9" fill="#374151">{cat.length>6?cat.slice(0,6)+"…":cat}</text></g>);})}
    <line x1={pL} y1={pT} x2={pL} y2={H-pB} stroke="#D1D5DB"/><line x1={pL} y1={H-pB} x2={W-pR} y2={H-pB} stroke="#D1D5DB"/>
    {series.map((sr,si)=><g key={si} transform={`translate(${pL+si*120},${H-5})`}><rect x="0" y="-7" width="9" height="9" fill={COLORS[si%COLORS.length]}/><text x="12" y="1" fontSize="8" fill="#374151">{sr.name.length>14?sr.name.slice(0,14)+"…":sr.name}</text></g>)}
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
// thumb: accurate SVG miniatures matching actual generated slide layouts
const SLIDE_THUMB = {
  // Cover: navy bg, decorative circles top-right, white title, cyan subtitle, red date pill, logo bottom-right
  "cover": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#0D1B4B"/>
      {/* decorative circles top-right */}
      <circle cx="148" cy="-2" r="38" fill="none" stroke="#1a2f6b" strokeWidth="10"/>
      <circle cx="148" cy="-2" r="24" fill="none" stroke="#1a2f6b" strokeWidth="8"/>
      {/* red top stripe */}
      <rect x="0" y="0" width="160" height="2.5" fill="#E8192C"/>
      {/* title */}
      <rect x="10" y="28" width="72" height="7" rx="1.5" fill="#ffffff"/>
      {/* cyan subtitle */}
      <rect x="10" y="40" width="50" height="4" rx="1" fill="#00B0F0"/>
      {/* italic tagline */}
      <rect x="10" y="48" width="36" height="2.5" rx="1" fill="#ffffff" opacity=".5"/>
      {/* red date pill */}
      <rect x="10" y="55" width="22" height="7" rx="3.5" fill="#E8192C"/>
      <rect x="14" y="57.5" width="14" height="2" rx="1" fill="#ffffff"/>
      {/* EMC logo placeholder bottom-right - enlarged */}
      <circle cx="146" cy="78" r="11" fill="none" stroke="#4a6fa5" strokeWidth="2.2"/>
      <circle cx="146" cy="78" r="6.5" fill="none" stroke="#E8192C" strokeWidth="1.5"/>
    </svg>
  ),

  // Mission: navy bg, circles, centered EMC globe icon, mission text
  "mission": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#0D1B4B"/>
      <rect x="0" y="0" width="160" height="2.5" fill="#E8192C"/>
      <circle cx="148" cy="-2" r="38" fill="none" stroke="#1a2f6b" strokeWidth="10"/>
      {/* large globe/circle icon center */}
      <circle cx="58" cy="40" r="18" fill="none" stroke="#00B0F0" strokeWidth="2.5"/>
      <ellipse cx="58" cy="40" rx="9" ry="18" fill="none" stroke="#00B0F0" strokeWidth="1.5"/>
      <line x1="40" y1="40" x2="76" y2="40" stroke="#00B0F0" strokeWidth="1.5"/>
      {/* text right side */}
      <rect x="84" y="28" width="48" height="5" rx="1" fill="#fff" opacity=".9"/>
      <rect x="84" y="36" width="56" height="3.5" rx="1" fill="#fff" opacity=".6"/>
      <rect x="84" y="42" width="52" height="3.5" rx="1" fill="#fff" opacity=".6"/>
      <rect x="84" y="48" width="44" height="3.5" rx="1" fill="#fff" opacity=".6"/>
      {/* EMC logo placeholder left side */}
      <circle cx="25" cy="78" r="12" fill="none" stroke="#4a6fa5" strokeWidth="2.5"/>
      <circle cx="25" cy="78" r="7" fill="none" stroke="#E8192C" strokeWidth="1.8"/>
    </svg>
  ),

  // District Profile: navy header, 6 metric boxes in 2 rows
  "district_profile": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#F8FAFC"/>
      <rect width="160" height="18" fill="#0D1B4B"/>
      <rect x="0" y="0" width="160" height="2.5" fill="#E8192C"/>
      <rect x="6" y="5" width="60" height="5" rx="1" fill="#fff" opacity=".9"/>
      <rect x="6" y="12" width="40" height="3" rx="1" fill="#00B0F0" opacity=".7"/>
      {/* 6 metric tiles 2x3 */}
      {[0,1,2,3,4,5].map(i=>{
        const col=i%3, row=Math.floor(i/3);
        const colors=["#0D1B4B","#00B0F0","#FFC000","#E8192C","#0D1B4B","#16A34A"];
        return(
          <g key={i}>
            <rect x={4+col*52} y={22+row*32} width="50" height="28" rx="2" fill={colors[i]} opacity=".85"/>
            <rect x={8+col*52} y={28+row*32} width="22" height="7" rx="1" fill="#fff" opacity=".9"/>
            <rect x={8+col*52} y={38+row*32} width="30" height="3" rx="1" fill="#fff" opacity=".5"/>
          </g>
        );
      })}
    </svg>
  ),

  // By the Numbers: 3 large circles with big numbers
  "by_the_numbers": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#F8FAFC"/>
      <rect width="160" height="16" fill="#0D1B4B"/>
      <rect x="0" y="0" width="160" height="2.5" fill="#E8192C"/>
      <rect x="6" y="5" width="50" height="4.5" rx="1" fill="#fff" opacity=".9"/>
      {[28,80,132].map((cx,i)=>{
        const fills=["#0D1B4B","#00B0F0","#FFC000"];
        return(
          <g key={i}>
            <circle cx={cx} cy="58" r="24" fill={fills[i]} opacity=".15"/>
            <circle cx={cx} cy="58" r="24" fill="none" stroke={fills[i]} strokeWidth="2.5"/>
            <rect x={cx-14} y="52" width="28" height="7" rx="1" fill={fills[i]}/>
            <rect x={cx-10} y="63" width="20" height="3" rx="1" fill="#6B7280"/>
          </g>
        );
      })}
    </svg>
  ),

  // HB3 Funds: vertical bars by class year, colored scale
  "hb3_funds": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#F8FAFC"/>
      <rect width="160" height="16" fill="#0D1B4B"/>
      <rect x="0" y="0" width="160" height="2.5" fill="#E8192C"/>
      <rect x="6" y="5" width="60" height="4.5" rx="1" fill="#fff" opacity=".9"/>
      {/* bars */}
      {[0,1,2,3,4].map(i=>{
        const h=[30,40,50,38,55][i];
        const fills=["#334155","#0D1B4B","#0D1B4B","#00B0F0","#FFC000"];
        return(
          <g key={i}>
            <rect x={16+i*28} y={82-h} width="20" height={h} rx="2" fill={fills[i]} opacity=".85"/>
            <rect x={18+i*28} y={85-h} width="12" height="4" rx="1" fill="#fff" opacity=".7"/>
          </g>
        );
      })}
      <line x1="8" y1="82" x2="152" y2="82" stroke="#9CA3AF" strokeWidth="1"/>
      {/* year labels */}
      {[0,1,2,3,4].map(i=>(
        <rect key={i} x={18+i*28} y="84" width="14" height="3" rx="1" fill="#9CA3AF"/>
      ))}
    </svg>
  ),

  // TSI Status Trends: dual line chart over years
  "tsi_status_trends": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#F8FAFC"/>
      <rect width="160" height="16" fill="#0D1B4B"/>
      <rect x="0" y="0" width="160" height="2.5" fill="#E8192C"/>
      <rect x="6" y="5" width="60" height="4.5" rx="1" fill="#fff" opacity=".9"/>
      {/* grid lines */}
      {[0,1,2,3].map(i=>(
        <line key={i} x1="18" y1={28+i*14} x2="152" y2={28+i*14} stroke="#E5E7EB" strokeWidth="0.8"/>
      ))}
      {/* ELAR line - dark navy */}
      <polyline points="18,72 44,58 70,50 96,44 122,36 148,28" fill="none" stroke="#0D1B4B" strokeWidth="2.5"/>
      {[18,44,70,96,122,148].map((x,i)=>(
        <circle key={i} cx={x} cy={[72,58,50,44,36,28][i]} r="3" fill="#0D1B4B"/>
      ))}
      {/* Math line - cyan */}
      <polyline points="18,78 44,68 70,62 96,58 122,52 148,46" fill="none" stroke="#00B0F0" strokeWidth="2.5"/>
      {[18,44,70,96,122,148].map((x,i)=>(
        <circle key={i} cx={x} cy={[78,68,62,58,52,46][i]} r="3" fill="#00B0F0"/>
      ))}
      <line x1="18" y1="80" x2="152" y2="80" stroke="#9CA3AF" strokeWidth="1"/>
      {/* legend */}
      <rect x="20" y="84" width="8" height="2" rx="1" fill="#0D1B4B"/>
      <rect x="20" y="88" width="20" height="2" rx="1" fill="#E5E7EB"/>
      <rect x="55" y="84" width="8" height="2" rx="1" fill="#00B0F0"/>
      <rect x="55" y="88" width="20" height="2" rx="1" fill="#E5E7EB"/>
    </svg>
  ),

  // TSI Status: horizontal stacked bars by campus
  "tsi_status": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#F8FAFC"/>
      <rect width="160" height="16" fill="#0D1B4B"/>
      <rect x="0" y="0" width="160" height="2.5" fill="#E8192C"/>
      <rect x="6" y="5" width="55" height="4.5" rx="1" fill="#fff" opacity=".9"/>
      {[0,1,2,3,4].map(i=>{
        const w1=[55,48,62,40,70][i];
        const w2=[25,30,20,35,18][i];
        return(
          <g key={i}>
            <rect x="38" y={21+i*13} width={w1} height="9" rx="1" fill="#0D1B4B" opacity=".8"/>
            <rect x={38+w1} y={21+i*13} width={w2} height="9" rx="1" fill="#00B0F0" opacity=".8"/>
            <rect x={38+w1+w2} y={21+i*13} width={80-w1-w2} height="9" rx="1" fill="#E5E7EB"/>
            <rect x="4" y={23+i*13} width="30" height="5" rx="1" fill="#9CA3AF"/>
          </g>
        );
      })}
    </svg>
  ),

  // TSI Leaderboard: ranked horizontal bars longest→shortest
  "tsi_leaderboard": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#F8FAFC"/>
      <rect width="160" height="16" fill="#0D1B4B"/>
      <rect x="0" y="0" width="160" height="2.5" fill="#E8192C"/>
      <rect x="6" y="5" width="55" height="4.5" rx="1" fill="#fff" opacity=".9"/>
      {[100,88,74,62,50,40].map((w,i)=>(
        <g key={i}>
          <rect x="36" y={20+i*11} width={w} height="8" rx="1"
            fill={i===0?"#FFC000":"#0D1B4B"} opacity={i===0?1:0.85-i*0.1}/>
          <rect x="36" y={20+i*11} width={w} height="8" rx="1" fill="none"
            stroke={i===0?"#D97706":"transparent"} strokeWidth="0.5"/>
          <rect x="4" y={22+i*11} width="28" height="4" rx="1" fill="#9CA3AF"/>
          {/* percent label inside bar */}
          <rect x={36+w-18} y={22+i*11} width="14" height="4" rx="1" fill="#fff" opacity=".6"/>
        </g>
      ))}
    </svg>
  ),

  // CCMR All Qualifiers: grouped/stacked horizontal bars per qualifier type
  "ccmr_pathway_full": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#F8FAFC"/>
      <rect width="160" height="16" fill="#0D1B4B"/>
      <rect x="0" y="0" width="160" height="2.5" fill="#E8192C"/>
      <rect x="6" y="5" width="60" height="4.5" rx="1" fill="#fff" opacity=".9"/>
      {[0,1,2,3,4,5,6].map(i=>{
        const w=[90,70,55,80,45,60,35][i];
        return(
          <g key={i}>
            <rect x="42" y={19+i*10} width={w} height="7" rx="1"
              fill={i%2===0?"#0D1B4B":"#00B0F0"} opacity=".75"/>
            <rect x="4" y={20+i*10} width="34" height="5" rx="1" fill="#E5E7EB"/>
          </g>
        );
      })}
    </svg>
  ),

  // CCMR YOY Breakdown: grouped vertical bars (3 groups × 3 series)
  "ccmr_yoy_breakdown": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#F8FAFC"/>
      <rect width="160" height="16" fill="#0D1B4B"/>
      <rect x="0" y="0" width="160" height="2.5" fill="#E8192C"/>
      <rect x="6" y="5" width="60" height="4.5" rx="1" fill="#fff" opacity=".9"/>
      {[0,1,2].map(gi=>(
        <g key={gi}>
          {[[35,"#FFC000"],[46,"#00B0F0"],[55,"#0D1B4B"]].map(([h,c],i)=>(
            <rect key={i} x={14+gi*48+i*12} y={82-h} width="10" height={h} rx="1.5"
              fill={c} opacity=".85"/>
          ))}
        </g>
      ))}
      <line x1="8" y1="82" x2="152" y2="82" stroke="#9CA3AF" strokeWidth="1"/>
      {/* x-axis year labels */}
      {[0,1,2].map(i=>(
        <rect key={i} x={18+i*48} y="84" width="20" height="3" rx="1" fill="#E5E7EB"/>
      ))}
    </svg>
  ),

  // CCMR A-F Status: donut chart + legend
  "ccmr_af_status": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#F8FAFC"/>
      <rect width="160" height="16" fill="#0D1B4B"/>
      <rect x="0" y="0" width="160" height="2.5" fill="#E8192C"/>
      <rect x="6" y="5" width="55" height="4.5" rx="1" fill="#fff" opacity=".9"/>
      {/* donut */}
      <circle cx="50" cy="56" r="24" fill="none" stroke="#E5E7EB" strokeWidth="12"/>
      <circle cx="50" cy="56" r="24" fill="none" stroke="#16A34A" strokeWidth="12"
        strokeDasharray="90.5 30.2" strokeDashoffset="23.6" strokeLinecap="round"/>
      <circle cx="50" cy="56" r="24" fill="none" stroke="#FFC000" strokeWidth="12"
        strokeDasharray="22.6 98.1" strokeDashoffset="-66.9" strokeLinecap="round"/>
      <circle cx="50" cy="56" r="24" fill="none" stroke="#E8192C" strokeWidth="12"
        strokeDasharray="7.5 113.2" strokeDashoffset="-89.5" strokeLinecap="round"/>
      {/* percent in center */}
      <circle cx="50" cy="56" r="13" fill="#F8FAFC"/>
      <rect x="40" y="52" width="20" height="6" rx="1" fill="#0D1B4B"/>
      <rect x="42" y="61" width="16" height="3" rx="1" fill="#9CA3AF"/>
      {/* legend */}
      {[["#16A34A","Met"],["#FFC000","Approaches"],["#E8192C","Not Met"]].map(([c,_],i)=>(
        <g key={i}>
          <rect x="86" y={24+i*18} width="8" height="8" rx="1" fill={c}/>
          <rect x="98" y={26+i*18} width="36" height="4" rx="1" fill="#374151"/>
          <rect x="98" y={32+i*18} width="24" height="3" rx="1" fill="#9CA3AF"/>
        </g>
      ))}
    </svg>
  ),

  // CCMR Pathway Analysis: stacked bar comparing on/off pathway
  "ccmr_pathway": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#F8FAFC"/>
      <rect width="160" height="16" fill="#0D1B4B"/>
      <rect x="0" y="0" width="160" height="2.5" fill="#E8192C"/>
      <rect x="6" y="5" width="55" height="4.5" rx="1" fill="#fff" opacity=".9"/>
      {[0,1,2,3].map(i=>{
        const pct=[0.72,0.61,0.55,0.80][i];
        const total=60;
        return(
          <g key={i}>
            <rect x="38" y={20+i*16} width={total*pct} height="11" rx="1.5" fill="#0D1B4B" opacity=".85"/>
            <rect x={38+total*pct} y={20+i*16} width={total*(1-pct)} height="11" rx="1.5" fill="#00B0F0" opacity=".7"/>
            <rect x="4" y={22+i*16} width="30" height="7" rx="1" fill="#E5E7EB"/>
          </g>
        );
      })}
      {/* legend */}
      <rect x="8" y="85" width="8" height="4" rx="1" fill="#0D1B4B" opacity=".85"/>
      <rect x="20" y="86" width="22" height="3" rx="1" fill="#9CA3AF"/>
      <rect x="55" y="85" width="8" height="4" rx="1" fill="#00B0F0" opacity=".7"/>
      <rect x="67" y="86" width="22" height="3" rx="1" fill="#9CA3AF"/>
    </svg>
  ),

  // Postsecondary Enrollment: horizontal bars by school (4YR, 2YR breakdown)
  "postsecondary_enrollment": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#F8FAFC"/>
      <rect width="160" height="16" fill="#0D1B4B"/>
      <rect x="0" y="0" width="160" height="2.5" fill="#E8192C"/>
      <rect x="6" y="5" width="68" height="4.5" rx="1" fill="#fff" opacity=".9"/>
      {[0,1,2,3,4].map(i=>{
        const w4=[55,48,40,62,36][i];
        const w2=[20,22,26,15,28][i];
        return(
          <g key={i}>
            <rect x="38" y={19+i*13} width={w4} height="9" rx="1" fill="#0D1B4B" opacity=".85"/>
            <rect x={38+w4} y={19+i*13} width={w2} height="9" rx="1" fill="#00B0F0" opacity=".8"/>
            <rect x={38+w4+w2} y={19+i*13} width={110-w4-w2} height="9" rx="1" fill="#E5E7EB" opacity=".5"/>
            <rect x="4" y={21+i*13} width="30" height="5" rx="1" fill="#E5E7EB"/>
          </g>
        );
      })}
    </svg>
  ),

  // Outro: same layout as cover but with thank-you focus
  "outro": (
    <svg viewBox="0 0 160 90" style={{width:"100%",height:"auto",display:"block"}}>
      <rect width="160" height="90" fill="#0D1B4B"/>
      <rect x="0" y="0" width="160" height="2.5" fill="#E8192C"/>
      <circle cx="148" cy="-2" r="38" fill="none" stroke="#1a2f6b" strokeWidth="10"/>
      <circle cx="148" cy="-2" r="24" fill="none" stroke="#1a2f6b" strokeWidth="8"/>
      <rect x="10" y="30" width="60" height="6" rx="1.5" fill="#ffffff"/>
      <rect x="10" y="40" width="42" height="3.5" rx="1" fill="#00B0F0"/>
      <rect x="10" y="47" width="50" height="2.5" rx="1" fill="#ffffff" opacity=".4"/>
      {/* globe icon */}
      <circle cx="148" cy="80" r="7" fill="none" stroke="#4a6fa5" strokeWidth="1.5"/>
      <circle cx="148" cy="80" r="4" fill="none" stroke="#E8192C" strokeWidth="1"/>
    </svg>
  ),
};

const SLIDE_INFO = {
  "cover":                   {name:"Cover Slide",           icon:"🎯", desc:"Title slide with district name, meeting type, and date", needsData:false},
  "mission":                 {name:"EMC Mission",            icon:"🌟", desc:"Every Learner On A Path To A Living Wage", needsData:false},
  "district_profile":        {name:"District Profile",       icon:"🏛️", desc:"6-metric overview: CCMR, TSI, IBC, Financial Aid, Enrollment, Associate Degree", needsData:true},
  "ccmr_pathway_full":       {name:"CCMR All Qualifiers",    icon:"🗺️", desc:"Full CCMR pathway breakdown: TSI ELAR, TSI Math, IBC, Dual Credit, AP/IB, OnRamps, and more", needsData:true},
  "outro":                   {name:"Outro / Thank You",    icon:"🙏", desc:"Closing thank you slide with district name and EMC mission", needsData:false},
  "by_the_numbers":          {name:"By the Numbers",         icon:"🔢", desc:"3-circle summary: students served, TSI met, HB3 projection", needsData:true},
  "hb3_funds":               {name:"HB3 Outcomes Bonus",     icon:"💰", desc:"HB3 funding by class year with verified/estimate/projected status", needsData:true},
  "tsi_status_trends":       {name:"TSI Status Trends", icon:"📈", desc:"TSI assessment results over multiple years", needsData:true},
  "tsi_status":              {name:"TSI Status",        icon:"📊", desc:"TSI results by campus for the latest year", needsData:true},
  "tsi_leaderboard":         {name:"TSI Leaderboard",   icon:"🏆", desc:"Ranked horizontal bar chart of TSI rates", needsData:true},
  "ccmr_yoy_breakdown":      {name:"CCMR YOY Growth",   icon:"📉", desc:"CCMR indicators (TSI, IBC, Enrollment) year-over-year", needsData:true},
  "ccmr_af_status":          {name:"CCMR A-F Status",   icon:"🎓", desc:"Met / Approaches / Not Met with progress to 90% goal", needsData:true},
  "ccmr_pathway":            {name:"CCMR Pathway Analysis",icon:"🛤️",desc:"Students on/off CCMR pathway by type", needsData:true},
  "postsecondary_enrollment":{name:"Postsecondary Enrollment",icon:"🏫",desc:"College enrollment rates (4YR, 2YR, etc.) by school", needsData:true},
};

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App(){
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
  function resetPreview(){setPreview(null);setEditLabels({});setEditSeries([]);setEditCategories([]);setEditInsights([]);setStatus({type:"",msg:""});}

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
      setStatus({type:"error",msg:`✗ ${msg}`});
    }finally{setPreviewing(false);}
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

  function buildOverrides(){
    return Object.fromEntries(Object.entries(colOverrides).map(([k,v])=>[k,v===MANUAL?"":v]));
  }

  // Change 12: Compose the footnote from source + date + any extra note
  function composeFootnote(){
    const src = (manualText.data_source||"").trim();
    const dt  = (manualText.as_of_date||"").trim();
    const extra = (manualText.footnote||"").trim();
    let base = src && dt ? `Source: ${src} as of ${dt}` : src ? `Source: ${src}` : dt ? `As of ${dt}` : "";
    return base && extra ? `${base} · ${extra}` : base || extra;
  }

    const FULLY_STATIC_TYPES = ["mission","methodology","section_divider","agenda","outro"];
  // ── Derived ───────────────────────────────────────────────────────────────
  const usableDistricts=(inspection?.districts||[]).filter(d=>d.usable);
  const hardMissing=(colDetection?.fields||[]).filter(f=>!f.optional&&!colOverrides[f.key]);
  const canPreview=!needsData||( !!colDetection&&hardMissing.length===0&&!detecting&&!previewing&&selectedDistricts.length>0);
  const canGenerate=canPreview&&!!preview&&!generating;
  const allSlides=Object.values(categoryMenu).flat();
  const curPresSlide=presSlides[presCurrentIdx];

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
                <p style={{fontSize:13,color:"#6B7280",marginBottom:18}}>Select the slides to include. You'll configure and approve each one individually before the final presentation is assembled.</p>
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
                    <div style={{fontWeight:700,color:"#0D1B4B",fontSize:14}}>
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
                          outline:i===presCurrentIdx?"2px solid #0D1B4B":"none",
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
                          color:s.status==="approved"?"#16A34A":s.status==="skipped"?"#9CA3AF":i===presCurrentIdx?"#0D1B4B":"#9CA3AF",
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
                  <div style={{fontSize:22,fontWeight:800,color:"#0D1B4B",marginBottom:8}}>All slides configured!</div>
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
                  <button className={`generate-btn ${buildingPres?"loading":""}`} style={{width:"auto",padding:"14px 36px",fontSize:16}} onClick={buildPresentation} disabled={buildingPres}>
                    {buildingPres?<><span className="spinner"/>Building presentation…</>:"▶ Build & Download Full Presentation"}
                  </button>
                  {buildingPres&&(
                    <div className="loading-status" style={{marginTop:8}}>
                      <span className="spinner dark" style={{width:14,height:14}}/>
                      <span>Generating all slides and assembling presentation — please wait…</span>
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
        {needsData&&(
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
                <button className={`generate-btn ${generating?"loading":""}`} onClick={handleGenerate} disabled={generating}>
                  {generating?<><span className="spinner"/>Generating…</>:<>▶ Generate &amp; Download</>}
                </button>
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
                  <input type="text" className="text-input"
                    style={{borderColor:f.required&&!(manualText[f.key]||"").trim()?"#FCA5A5":""}}
                    placeholder={f.placeholder}
                    value={manualText[f.key]||""}
                    onChange={e=>{
                      const val=e.target.value;
                      setManualText(p=>({...p,[f.key]:val}));
                      // Cache for subsequent slides (both state and ref)
                      if(isPresMode){
                        presMetaCacheRef.current = {...presMetaCacheRef.current,[f.key]:val};
                        setPresMetaCache({...presMetaCacheRef.current});
                      }
                      resetPreview();
                    }}/>
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
                📄 Footnote will read: <em style={{color:"#0D1B4B"}}>
                  "Source: {manualText.data_source||"—"} as of {manualText.as_of_date||"—"}"
                  {manualText.footnote?` · ${manualText.footnote}`:""}
                </em>
              </div>
            )}

            {!preview?(
              <>
                <button className={`preview-btn ${previewing?"loading":""}`} onClick={handlePreview} disabled={previewing}>
                  {previewing?<><span className="spinner"/>Calculating…</>:"👁 Calculate Preview"}
                </button>
                {previewing&&(
                  <div className="loading-banner">
                    <span className="spinner" style={{width:18,height:18}}/>
                    <div>
                      <div style={{fontWeight:700,fontSize:13}}>Calculating preview…</div>
                      <div style={{fontSize:11,opacity:.8}}>Analyzing your data and generating insights</div>
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
                      <div style={{padding:"10px 16px",background:"#0D1B4B",color:"white",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
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
                  {isPresMode&&(
                    <>
                      <button className="preview-btn" style={{background:"#16A34A",border:"none"}} onClick={onApprove}>✓ Approve — next slide →</button>
                      <button className="recalc-btn" style={{color:"#6B7280"}} onClick={onSkip}>⏭ Skip this slide</button>
                    </>
                  )}
                </div>
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
            <button className={`generate-btn ${generating?"loading":""}`} onClick={handleGenerate} disabled={generating}>
              {generating?<><span className="spinner"/>Generating slide HTML…</>:<>▶&nbsp;Generate &amp; Download Slide</>}
            </button>
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
