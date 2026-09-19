(() => {
'use strict';

const DEFAULT_API = 'https://script.google.com/macros/s/AKfycbySBtk2dw-jCpW9R4bUW8D4ncMArMRNuemNfIBdewpX8ERURlMaukoY_TqUv_cLea-Wdg/exec';
const LS = {
  measures:'ppv2_measures', routine:'ppv2_routine', profile:'ppv2_profile', scans:'ppv2_scans', api:'ppv2_api',
  legacyMeasures:'st_regs', legacyApi:'st_url'
};
const state = {
  view:'overview', measures:[], routine:[], profile:{altura:null,reminderInterval:14,reminderTime:'07:00'}, scans:[],
  hevy:[], apiUrl:'', syncing:false, online:false, version:'', metric:'peso', installPrompt:null, calDate:'', calAdding:null
};
const METRICS = [
  {k:'peso',l:'Peso',u:'kg'}, {k:'cintura',l:'Cintura',u:'cm'}, {k:'abdomen',l:'Abdômen',u:'cm'},
  {k:'peito',l:'Peitoral',u:'cm'}, {k:'ombros',l:'Ombros',u:'cm'}, {k:'pescoco',l:'Pescoço',u:'cm'},
  {k:'biceps',l:'Bíceps médio',u:'cm',fn:r=>avg(r.bicepsD,r.bicepsE)},
  {k:'coxa',l:'Coxa média',u:'cm',fn:r=>avg(r.coxaD,r.coxaE)}, {k:'panturrilha',l:'Panturrilha média',u:'cm',fn:r=>avg(r.panD,r.panE)},
  {k:'quadril',l:'Quadril',u:'cm'}, {k:'bf',l:'BF estimado',u:'%',fn:r=>calcBF(r)}, {k:'ffmi',l:'FFMI estimado',u:'',fn:r=>calcFFMI(r)}
];
const NAV = [
  ['overview','Visão Geral','⌂'],['measures','Medidas','↗'],['evolution','Evolução','∿'],['add','Nova medição','＋'],
  ['history','Histórico','◷'],['scan','Scan','▣'],['routine','Rotina','◴'],['calories','Calorias','◈'],['plank','Prancha','⏱'],['settings','Config','⚙']
];
const BOTTOM = ['overview','evolution','add','scan','routine'];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const today = () => new Date().toISOString().slice(0,10);
const fmtDate = d => d ? new Date(d+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
const num = v => { const n=parseFloat(String(v ?? '').replace(',','.')); return Number.isFinite(n)?n:null; };
const fmt = (v,d=1) => v==null || !Number.isFinite(+v) ? '—' : (+v).toFixed(d).replace('.',',');
const avg = (a,b) => {a=num(a);b=num(b); if(a!=null&&b!=null)return (a+b)/2; return a??b;};
const metric = k => METRICS.find(x=>x.k===k);
const val = (r,m) => { if(!r)return null; if(m.fn)return m.fn(r); const n=num(r[m.k]); return n===0?null:n; };
const last = () => state.measures.at(-1) || null;
const prev = () => state.measures.at(-2) || null;
const delta = (m) => {const a=val(last(),m),b=val(prev(),m);return a!=null&&b!=null?+(a-b).toFixed(1):null;};

function calcBF(r){
  if(!r)return null; const peso=num(r.peso), alt=num(r.altura), pesc=num(r.pescoco), cin=num(r.cintura);
  if(!peso||!alt||!pesc||!cin||cin<=pesc)return num(r.gordura);
  const out=495/(1.0324-0.19077*Math.log10(cin-pesc)+0.15456*Math.log10(alt))-450;
  return Number.isFinite(out)&&out>=3&&out<=55?+out.toFixed(1):(num(r.gordura)||null);
}
function calcFFMI(r){const peso=num(r?.peso),alt=num(r?.altura),bf=calcBF(r);if(!peso||!alt||bf==null)return num(r?.ffmi);const h=alt/100;return +(peso*(1-bf/100)/(h*h)).toFixed(1)}
function calcLBM(r){const peso=num(r?.peso),bf=calcBF(r);return peso&&bf!=null?+(peso*(1-bf/100)).toFixed(1):num(r?.massaMagra)}

/* ===== INSIGHTS (aditivo, tudo front-end, sem tocar no backend) ===== */
const KCAL_PER_KG=7700; // energia por kg de tecido corporal (aprox.)
// Regressão linear do peso ao longo do tempo -> kg/semana + déficit/superávit kcal/dia implícito.
function weightTrend(){
  try{
    const pts=state.measures.map(r=>({t:new Date(r.data+'T12:00:00').getTime(),v:num(r.peso)})).filter(p=>p.v!=null&&Number.isFinite(p.t));
    if(pts.length<2)return null;
    const t0=pts[0].t, xs=pts.map(p=>(p.t-t0)/864e5), ys=pts.map(p=>p.v); // x em dias
    const n=xs.length, sx=xs.reduce((a,b)=>a+b,0), sy=ys.reduce((a,b)=>a+b,0);
    const sxx=xs.reduce((a,b)=>a+b*b,0), sxy=xs.reduce((a,b,i)=>a+b*ys[i],0);
    const denom=n*sxx-sx*sx; if(!denom)return null;
    const slope=(n*sxy-sx*sy)/denom; // kg por dia
    const perWeek=+(slope*7).toFixed(2);
    const kcalDay=Math.round(slope*KCAL_PER_KG); // >0 superávit, <0 déficit
    const spanDays=Math.round(xs.at(-1)-xs[0]);
    return {perWeek,kcalDay,spanDays,points:n};
  }catch{return null}
}
// Score de recuperação 0-100 a partir do que a rotina já coleta + sono/humor (novos, opcionais).
function recoveryFromRoutine(r){
  if(!r)return null;
  const parts=[]; // cada item: [valor0a1, peso]
  const sono=num(r.sono); if(sono!=null)parts.push([Math.max(0,Math.min(1,sono/8)),1.4]); // alvo ~8h
  const humor=num(r.humor); if(humor!=null)parts.push([(Math.max(1,Math.min(5,humor))-1)/4,1]);
  const energia=num(r.energia); if(energia!=null)parts.push([(Math.max(1,Math.min(5,energia))-1)/4,1.2]);
  const fome=num(r.fome); if(fome!=null)parts.push([1-(Math.max(1,Math.min(5,fome))-1)/4,0.6]); // fome alta reduz
  const dig=num(r.digestao); if(dig!=null)parts.push([(Math.max(1,Math.min(5,dig))-1)/4,0.6]);
  if(!parts.length)return null;
  const wsum=parts.reduce((a,p)=>a+p[1],0), acc=parts.reduce((a,p)=>a+p[0]*p[1],0);
  return Math.round((acc/wsum)*100);
}
function recoveryToday(){try{return recoveryFromRoutine(routineToday())}catch{return null}}
function recoveryLabel(s){return s==null?['—','flat','Registre sono e humor na Rotina para calcular.']:s>=80?[`${s} · Pronto`,'up','Sinais bons — dá para treinar pesado.']:s>=55?[`${s} · Moderado`,'flat','Treine, mas atento à recuperação.']:[`${s} · Baixo`,'low','Considere treino leve, mais sono ou comida.']}
// Estagnação (stall) por métrica: variação absoluta pequena por N dias.
function stallInfo(s,m){
  try{
    if(!s||s.length<2)return null;
    const lastP=s.at(-1), firstIdx=(()=>{ // ponto ~21 dias antes do último com dados
      const cut=new Date(lastP.date+'T12:00:00').getTime()-21*864e5;
      for(let i=s.length-1;i>=0;i--){if(new Date(s[i].date+'T12:00:00').getTime()<=cut)return i}
      return 0;
    })();
    const base=s[firstIdx]; if(!base||base.date===lastP.date)return null;
    const days=Math.round((new Date(lastP.date+'T12:00:00')-new Date(base.date+'T12:00:00'))/864e5);
    if(days<14)return null;
    const change=Math.abs(lastP.v-base.v);
    const thr=(m&&(m.k==='peso'))?0.6:(m&&m.u==='%'?0.5:(m&&m.u==='cm'?0.4:0.3));
    if(change<thr)return {days,change:+change.toFixed(1),base:base.date};
    return null;
  }catch{return null}
}
// Insight composto: cruza peso + cintura + recuperação + Hevy numa leitura única.
function compositeInsight(){
  try{
    if(state.measures.length<2)return null;
    const wt=weightTrend();
    const cinS=series(metric('cintura')), cinD=cinS.length>=2?+(cinS.at(-1).v-cinS[0].v).toFixed(1):null;
    const rec=recoveryTrendAvg();
    const treinos=Array.isArray(state.hevy)?state.hevy.length:0;
    const bits=[];
    let head='Leitura geral';
    if(wt){
      const w=wt.perWeek;
      if(w<=-0.15){head='Emagrecimento em curso';bits.push(`peso caindo ~${fmt(Math.abs(w),2)} kg/sem${cinD!=null&&cinD<0?` e cintura -${fmt(Math.abs(cinD),1)} cm`:''}`);}
      else if(w>=0.15){head=cinD!=null&&cinD<=0?'Ganho com cintura sob controle':'Peso subindo';bits.push(`peso subindo ~${fmt(w,2)} kg/sem${cinD!=null?`, cintura ${cinD>0?'+':''}${fmt(cinD,1)} cm`:''}`);}
      else{head='Fase de manutenção';bits.push('peso praticamente estável');}
      if(Number.isFinite(wt.kcalDay)&&Math.abs(wt.kcalDay)>=80)bits.push(`${wt.kcalDay<0?'déficit':'superávit'} implícito de ~${Math.abs(wt.kcalDay)} kcal/dia`);
    }
    if(treinos)bits.push(`${treinos} treino${treinos>1?'s':''} no período carregado do Hevy`);
    let tail='';
    if(rec!=null){
      if(rec<55)tail=` Recuperação média está baixa (${rec}/100) — priorize sono ou reduza volume antes de forçar.`;
      else if(rec>=80)tail=` Recuperação média alta (${rec}/100) — há margem para progredir carga.`;
      else tail=` Recuperação média em ${rec}/100.`;
    }
    if(!bits.length)return null;
    return {head,body:cap(bits.join(', '))+'.'+tail};
  }catch{return null}
}
function recoveryTrendAvg(){try{const last7=state.routine.filter(x=>(Date.now()-new Date(String(x.data).slice(0,10)+'T12:00:00'))/864e5<=10);const vals=last7.map(recoveryFromRoutine).filter(v=>v!=null);return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null}catch{return null}}
function cap(s){return s?s.charAt(0).toUpperCase()+s.slice(1):s}

/* ===== ANÁLISE DE TREINO (Hevy) — front-end, usa o que hevy_workouts já devolve ===== */
// muscle_group do Hevy -> rótulo PT, grupo de volume, categoria (push/pull/legs/core), faixas semanais de séries.
// Faixas de referência (MEV/MRV) inspiradas no volume landmarks do Dr. Mike Israetel / RP.
const MUSCLE_META={
  chest:{l:'Peito',g:'chest',cat:'push',mev:8,mav:18,mrv:22},
  shoulders:{l:'Ombros',g:'shoulders',cat:'push',mev:8,mav:18,mrv:26},
  triceps:{l:'Tríceps',g:'triceps',cat:'push',mev:6,mav:12,mrv:18},
  lats:{l:'Dorsais',g:'back',cat:'pull',mev:10,mav:18,mrv:25},
  upper_back:{l:'Costas (superior)',g:'back',cat:'pull',mev:10,mav:18,mrv:25},
  traps:{l:'Trapézio',g:'traps',cat:'pull',mev:4,mav:12,mrv:20},
  biceps:{l:'Bíceps',g:'biceps',cat:'pull',mev:6,mav:12,mrv:20},
  forearms:{l:'Antebraço',g:'forearms',cat:'pull',mev:4,mav:8,mrv:16},
  quadriceps:{l:'Quadríceps',g:'quads',cat:'legs',mev:8,mav:16,mrv:20},
  hamstrings:{l:'Posterior',g:'hamstrings',cat:'legs',mev:6,mav:12,mrv:20},
  glutes:{l:'Glúteos',g:'glutes',cat:'legs',mev:4,mav:10,mrv:16},
  calves:{l:'Panturrilha',g:'calves',cat:'legs',mev:8,mav:14,mrv:20},
  abdominals:{l:'Abdômen',g:'abs',cat:'core',mev:0,mav:12,mrv:25},
  lower_back:{l:'Lombar',g:'lowerback',cat:'core',mev:2,mav:8,mrv:14},
  abductors:{l:'Abdutores',g:'abductors',cat:'legs',mev:0,mav:8,mrv:16},
  adductors:{l:'Adutores',g:'adductors',cat:'legs',mev:0,mav:8,mrv:16},
  neck:{l:'Pescoço',g:'neck',cat:'other',mev:0,mav:6,mrv:12}
  // cardio, full_body, other -> ignorados no volume
};
const SECONDARY_WEIGHT=0.5; // séries em músculo secundário contam meio
function isWorkSet(s){const t=String(s&&s.type||'normal').toLowerCase();return t!=='warmup'&&t!=='warm_up'}
// Agrega volume (séries/semana) por grupo muscular a partir de state.hevy.
function hevyVolume(){
  try{
    const ws=Array.isArray(state.hevy)?state.hevy:[]; if(!ws.length)return null;
    // janela em dias: do treino mais antigo ao mais novo (mín 7)
    const times=ws.map(w=>Date.parse(w.start_time||w.date||w.created_at||'')).filter(Number.isFinite);
    const spanDays=times.length?Math.max(7,Math.round((Math.max(...times)-Math.min(...times))/864e5)+1):7;
    const weeks=Math.max(1,spanDays/7);
    const byMuscle={}; let rpeSum=0,rpeN=0,workSets=0;
    ws.forEach(w=>{(w.exercises||[]).forEach(ex=>{
      const setsArr=(ex.sets||[]).filter(isWorkSet), n=setsArr.length; if(!n)return;
      workSets+=n;
      setsArr.forEach(s=>{const r=num(s.rpe);if(r!=null){rpeSum+=r;rpeN++}});
      const prim=String(ex.muscle_group||'').toLowerCase();
      if(MUSCLE_META[prim])byMuscle[prim]=(byMuscle[prim]||0)+n;
      (ex.other_muscles||[]).forEach(om=>{const k=String(om||'').toLowerCase();if(MUSCLE_META[k])byMuscle[k]=(byMuscle[k]||0)+n*SECONDARY_WEIGHT});
    })});
    if(!Object.keys(byMuscle).length)return null;
    const perWeek={}; Object.keys(byMuscle).forEach(k=>{perWeek[k]=+(byMuscle[k]/weeks).toFixed(1)});
    // push vs pull (séries/semana somadas)
    let push=0,pull=0; Object.keys(perWeek).forEach(k=>{const c=MUSCLE_META[k].cat;if(c==='push')push+=perWeek[k];else if(c==='pull')pull+=perWeek[k]});
    const rpeAvg=rpeN?+(rpeSum/rpeN).toFixed(1):null;
    return {perWeek,push:+push.toFixed(1),pull:+pull.toFixed(1),rpeAvg,rpeN,spanDays,weeks:+weeks.toFixed(1),workouts:ws.length,workSets};
  }catch{return null}
}
function volStatus(v,m){ // v=séries/semana, m=meta
  if(v<m.mev)return['abaixo do mínimo','low',`abaixo do MEV (${m.mev})`];
  if(v>m.mrv)return['acima do máximo','low',`acima do MRV (${m.mrv})`];
  if(v>=m.mev&&v<=m.mav)return['faixa produtiva','up',`ideal ${m.mev}–${m.mrv}`];
  return['perto do teto','flat',`ideal ${m.mev}–${m.mrv}`];
}
// Sinal de deload: RPE médio alto + recuperação baixa + peso travado.
function deloadSignal(vol){
  try{
    const reasons=[]; if(vol&&vol.rpeAvg!=null&&vol.rpeAvg>=8.7)reasons.push(`RPE médio ${fmt(vol.rpeAvg)} (alto)`);
    const rec=recoveryTrendAvg(); if(rec!=null&&rec<55)reasons.push(`recuperação ${rec}/100 (baixa)`);
    const wt=weightTrend(); if(wt&&Math.abs(wt.perWeek)<0.15&&state.measures.length>=3)reasons.push('peso travado');
    return reasons.length>=2?reasons:null;
  }catch{return null}
}

function readJSON(k,fallback){try{return JSON.parse(localStorage.getItem(k)||'')||fallback}catch{return fallback}}
function writeJSON(k,v){localStorage.setItem(k,JSON.stringify(v))}
function detectLegacy(){
  const old=readJSON(LS.legacyMeasures,[]); if(!localStorage.getItem(LS.measures)&&Array.isArray(old)&&old.length) writeJSON(LS.measures,old);
  const oldUrl=localStorage.getItem(LS.legacyApi); if(!localStorage.getItem(LS.api)&&oldUrl) localStorage.setItem(LS.api,oldUrl);
}
function loadCache(){
  detectLegacy(); state.measures=readJSON(LS.measures,[]); state.routine=readJSON(LS.routine,[]); state.profile=Object.assign(state.profile,readJSON(LS.profile,{})); state.scans=readJSON(LS.scans,[]);
  state.apiUrl=localStorage.getItem(LS.api)||findApiInStorage()||DEFAULT_API; localStorage.setItem(LS.api,state.apiUrl);
  state.measures=state.measures.map(normalizeMeasure).filter(r=>r.data||r.peso).sort((a,b)=>String(a.data).localeCompare(String(b.data)));
}
function saveCache(){writeJSON(LS.measures,state.measures);writeJSON(LS.routine,state.routine);writeJSON(LS.profile,state.profile);writeJSON(LS.scans,state.scans)}
function findApiInStorage(){for(let i=0;i<localStorage.length;i++){const v=localStorage.getItem(localStorage.key(i))||'';if(/script\.google(usercontent)?\.com\/macros\//.test(v)&&/\/exec/.test(v))return v}return ''}
function normalizeMeasure(r={}){const keys=['peso','altura','pescoco','cintura','abdomen','quadril','peito','ombros','bicepsD','bicepsE','antD','antE','coxaD','coxaE','panD','panE','gordura','massaMagra','ffmi'];const o={...r,data:String(r.data||'').split('T')[0]};keys.forEach(k=>{const n=num(r[k]);o[k]=n==null?0:n});o.id=String(r.id||`${o.data}_${o.peso}`);return o}

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('on');clearTimeout(t._x);t._x=setTimeout(()=>t.classList.remove('on'),2600)}
function setSync(ok,text,sub='Google Sheets'){state.online=ok;$('#syncDot').className='status-dot '+(ok?'ok':'err');$('#syncText').textContent=text;$('#syncSub').textContent=sub}
function notice(text=''){const n=$('#notice');n.hidden=!text;n.textContent=text}

async function apiGet(action,params={}){
  if(!state.apiUrl)return null; const u=new URL(state.apiUrl);u.searchParams.set('action',action);u.searchParams.set('_',Date.now());Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
  const c=new AbortController(), timer=setTimeout(()=>c.abort(),12000);
  try{const r=await fetch(u,{cache:'no-store',signal:c.signal});const txt=await r.text();return JSON.parse(txt.replace(/^\uFEFF/,''))}catch(e){return null}finally{clearTimeout(timer)}
}
async function apiPost(action,payload={}){
  if(!state.apiUrl)return null; const body={...payload,action};
  try{const r=await fetch(state.apiUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body)});const txt=await r.text();return JSON.parse(txt.replace(/^\uFEFF/,''))}catch{return null}
}
async function syncAll(showToast=false){
  if(state.syncing)return; state.syncing=true; setSync(false,'Sincronizando…');
  let ok=false;
  try{
    const boot=await apiGet('bootstrap');
    if(boot?.success){
      if(Array.isArray(boot.medidas))state.measures=boot.medidas.map(normalizeMeasure).sort((a,b)=>String(a.data).localeCompare(String(b.data)));
      if(Array.isArray(boot.rotina))state.routine=boot.rotina;
      if(Array.isArray(boot.scans))state.scans=boot.scans;
      if(Array.isArray(boot.perfil)&&boot.perfil[0])state.profile=Object.assign(state.profile,boot.perfil[0]);
      state.version=boot._version||''; ok=true;
    }else{
      const m=await apiGet('get');
      if(m?.success&&Array.isArray(m.registros)){state.measures=m.registros.map(normalizeMeasure).sort((a,b)=>String(a.data).localeCompare(String(b.data)));state.version=m._version||'';ok=true}
      const rt=await apiGet('routine_get'); if(rt?.success&&Array.isArray(rt.registros))state.routine=rt.registros;
      const pf=await apiGet('profile_get'); if(pf?.success&&Array.isArray(pf.registros)&&pf.registros[0])state.profile=Object.assign(state.profile,pf.registros[0]);
    }
    if(ok){saveCache();setSync(true,`${state.measures.length} medições`,state.version||'Google Sheets');notice('');render()}
    else{setSync(false,'Modo local');notice('Não consegui atualizar o Google Sheets agora. Seus dados locais continuam disponíveis.')}
  }finally{state.syncing=false;if(showToast)toast(ok?'Dados atualizados':'Não foi possível sincronizar')}
}

function buildNav(){
  $('#sideNav').innerHTML=NAV.map(([id,l,i])=>`<button class="nav-btn ${state.view===id?'on':''}" data-view="${id}"><span class="nav-ic">${i}</span>${l}</button>`).join('');
  $('#bottomNav').innerHTML=BOTTOM.map(id=>{const n=NAV.find(x=>x[0]===id);return `<button class="${state.view===id?'on':''}" data-view="${id}">${n[2]}<br>${n[1]}</button>`}).join('');
  $$('[data-view]').forEach(b=>b.onclick=()=>go(b.dataset.view));
}
function go(v){stopPlank();state.view=v;const n=NAV.find(x=>x[0]===v);$('#pageTitle').textContent=n?.[1]||'Physique Pro';$('#pageEyebrow').textContent=v==='overview'?'PAINEL':'PHYSIQUE PRO';buildNav();render();window.scrollTo({top:0,behavior:'smooth'})}
function render(){buildNav(); const f={overview:renderOverview,measures:renderMeasures,evolution:renderEvolution,add:renderAdd,history:renderHistory,scan:renderScan,routine:renderRoutine,calories:renderCalories,plank:renderPlank,settings:renderSettings}[state.view]||renderOverview;f()}
function empty(title,desc,action='add',label='Nova medição'){return `<div class="card empty"><div class="empty-ic">＋</div><h3>${esc(title)}</h3><p>${esc(desc)}</p><button class="primary-btn" data-go="${action}">${esc(label)}</button></div>`}
function wireGo(){$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go))}

function overviewStatus(){
  if(!state.measures.length)return ['Comece pelo primeiro registro','Registre suas medidas para montar sua linha do tempo.'];
  if(state.measures.length===1)return ['Base criada','Já temos seu ponto inicial. O próximo registro permitirá comparar mudanças.'];
  const a=last(),b=prev(),days=Math.max(1,Math.round((new Date(a.data)-new Date(b.data))/864e5));
  let changed=0,stable=0; METRICS.slice(0,10).forEach(m=>{const x=val(a,m),y=val(b,m);if(x==null||y==null)return;Math.abs(x-y)>=0.4?changed++:stable++});
  return changed?['Há mudanças para revisar',`${changed} medidas mudaram de forma visível entre os dois últimos registros (${days} dias).`]:['Perfil estável','Os dois últimos registros estão próximos. Continue usando o mesmo protocolo de medição.'];
}
function proteinWeekAvg(){try{const days=state.routine.filter(x=>(Date.now()-new Date(String(x.data).slice(0,10)+'T12:00:00'))/864e5<=8);const vals=days.map(x=>{const t=num(x.proteinaTotal);return t!=null&&t>0?t:proteinFromRoutine(x)}).filter(v=>v>0);return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null}catch{return null}}
function weeklyReport(){
  try{
    const paras=[];
    const wt=weightTrend(),cinS=series(metric('cintura')),cinD=cinS.length>=2?+(cinS.at(-1).v-cinS[0].v).toFixed(1):null;
    const rec=recoveryTrendAvg(),prot=proteinWeekAvg(),goal=proteinGoal();
    const vol=hevyVolume(),deload=vol?deloadSignal(vol):null;
    if(wt){let s;const w=wt.perWeek;
      if(w<=-0.15)s=`No corpo, o peso vem caindo cerca de ${fmt(Math.abs(w),2)} kg por semana`;
      else if(w>=0.15)s=`No corpo, o peso vem subindo cerca de ${fmt(w,2)} kg por semana`;
      else s='No corpo, o peso está praticamente estável';
      if(cinD!=null&&Math.abs(cinD)>=0.3)s+=` e a cintura ${cinD>0?'aumentou':'reduziu'} ${fmt(Math.abs(cinD),1)} cm no período`;
      if(Number.isFinite(wt.kcalDay)&&Math.abs(wt.kcalDay)>=80)s+=`, indicando ${wt.kcalDay<0?'déficit':'superávit'} de aproximadamente ${Math.abs(wt.kcalDay)} kcal/dia`;
      paras.push(s+'.');
    }
    if(prot!=null){let s=`Na alimentação, sua média foi de ${prot} g de proteína por dia`;
      if(goal){const pc=Math.round(prot/goal*100);s+=pc>=95?` — batendo a meta de ${goal} g`:` — abaixo da meta de ${goal} g (${pc}%)`;}
      paras.push(s+'.');
    }
    if(vol){let s=`No treino, foram ${vol.workouts} sessões`;
      if(vol.rpeAvg!=null)s+=` com RPE médio ${fmt(vol.rpeAvg)}`;
      const ratio=vol.pull>0?vol.push/vol.pull:null;
      if(ratio!=null&&ratio>=1.5)s+=', e o volume de empurrar está bem acima do de puxar';
      paras.push(s+'.');
    }
    if(rec!=null)paras.push(`A recuperação média ficou em ${rec}/100${rec<55?', o que está baixo':rec>=80?', o que está ótimo':''}.`);
    if(!paras.length)return null;
    let melhorar;
    if(rec!=null&&rec<55)melhorar='priorizar sono e recuperação — é o que mais está te segurando agora';
    else if(prot!=null&&goal&&prot<goal*0.9)melhorar=`subir a proteína: faltam cerca de ${goal-prot} g por dia para a meta`;
    else if(deload)melhorar='encaixar uma semana de deload — os sinais de fadiga estão se acumulando';
    else if(vol&&vol.pull>0&&vol.push/vol.pull>=1.5)melhorar='adicionar séries de puxada (costas e bíceps) para equilibrar com o empurrar';
    else melhorar='manter a consistência — os números estão coerentes com o objetivo';
    return {paras,melhorar};
  }catch{return null}
}
function weeklyReportCard(){
  const r=weeklyReport();if(!r)return '';
  return `<div class="card pad report-card"><span class="eyebrow">RESUMO DA SEMANA</span><div class="report-body">${r.paras.map(p=>`<p>${esc(p)}</p>`).join('')}<p class="report-do"><b>Próximo passo:</b> ${esc(r.melhorar)}.</p></div></div>`;
}
function overviewInsightBlock(){
  try{
    const ci=compositeInsight(), wt=weightTrend(), rec=recoveryTrendAvg();
    let html=weeklyReportCard();
    const cards=[];
    if(wt){const w=wt.perWeek,cls=Math.abs(w)<0.15?'flat':(w<0?'up':'low');cards.push(`<div class="card kpi"><div class="label">RITMO DE PESO</div><div class="value">${w>0?'+':''}${fmt(w,2)}<span style="font:600 11px var(--font);color:var(--muted)"> kg/sem</span></div><div class="meta">${wt.spanDays} dias · ${wt.points} medições</div></div>`);
      const k=wt.kcalDay;cards.push(`<div class="card kpi"><div class="label">BALANÇO IMPLÍCITO</div><div class="value">${Number.isFinite(k)?`${k>0?'+':''}${k}`:'—'}<span style="font:600 11px var(--font);color:var(--muted)"> kcal/d</span></div><div class="meta">${!Number.isFinite(k)?'—':k<0?'déficit estimado':k>0?'superávit estimado':'manutenção'}</div></div>`);}
    const [rl,,]=recoveryLabel(rec);cards.push(`<div class="card kpi"><div class="label">RECUPERAÇÃO MÉDIA</div><div class="value" style="font-size:20px">${rec==null?'—':rl}</div><div class="meta">${rec==null?'registre sono/humor na Rotina':'média recente da rotina'}</div></div>`);
    if(cards.length)html+=`<div class="grid cols-3" style="margin-top:14px">${cards.join('')}</div>`;
    return html;
  }catch{return ''}
}
function renderOverview(){
  const v=$('#view'); if(!state.measures.length){v.innerHTML=empty('Seu painel está pronto','Conecte seus dados e registre uma medição para começar.');wireGo();return}
  const [st,sd]=overviewStatus(),a=last(),days=Math.floor((Date.now()-new Date(a.data+'T12:00:00'))/864e5),fresh=Math.max(0,Math.min(100,100-(days*4)));
  const bf=calcBF(a),ff=calcFFMI(a),lb=calcLBM(a),wa=num(a.cintura);
  const kp=[['Peso',fmt(a.peso)+' kg',metricDelta('peso')],['Cintura',fmt(wa)+' cm',metricDelta('cintura')],['BF estimado',bf==null?'—':fmt(bf)+' %','estimativa por medidas'],['FFMI estimado',ff==null?'—':fmt(ff),'contexto de composição']];
  const recent=METRICS.slice(0,10).map(m=>metricCard(m)).join('');
  v.innerHTML=`<div class="card hero"><div><span class="eyebrow">RESUMO ATUAL</span><h2>${esc(st)}</h2><p>${esc(sd)}</p></div><div class="hero-ring" style="--pct:${fresh}%"><div><b>${fresh}%</b><small>ATUALIDADE</small></div></div></div>
  ${overviewInsightBlock()}
  <div class="grid cols-4" style="margin-top:14px">${kp.map(x=>`<div class="card kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="meta">${x[2]}</div></div>`).join('')}</div>
  <div class="section-head"><div><h3>Últimas medidas</h3><p>${fmtDate(a.data)} · ${state.measures.length} registros no histórico</p></div><span class="link" data-go="measures">Ver todas</span></div>
  <div class="grid cols-3">${recent}</div>
  <div class="section-head"><div><h3>Próximas ações</h3><p>O app prioriza consistência de registro e comparação com seu próprio histórico.</p></div></div>
  <div class="grid cols-3">${actionCard('Registrar novamente','Use o mesmo horário e os mesmos pontos de referência.','add')}${actionCard('Analisar evolução','Veja tendência, taxa e confiança em uma única tela.','evolution')}${actionCard('Fotos comparáveis','Repita frente, lateral e costas com enquadramento semelhante.','scan')}</div>`;wireGo()
}
function metricDelta(k){const m=metric(k),d=m?delta(m):null;return d==null?'sem comparação':`${d>0?'+':''}${fmt(d)} ${m.u} desde o anterior`}
function actionCard(t,d,g){return `<div class="card pad"><b style="font:700 13px var(--display)">${t}</b><p style="color:var(--muted);font-size:10px;line-height:1.55">${d}</p><button class="ghost-btn" data-go="${g}">Abrir</button></div>`}
function metricCard(m){const a=val(last(),m),d=delta(m);return `<div class="card metric-card" data-metric="${m.k}"><div class="metric-top"><span class="metric-name">${m.l}</span><span class="metric-date">${fmtDate(last()?.data)}</span></div><div class="metric-value">${fmt(a)}<span>${m.u}</span></div><div class="metric-foot">${d==null?'sem comparação':`${d>0?'+':''}${fmt(d)} ${m.u} vs. anterior`}</div></div>`}

function renderMeasures(){
  const v=$('#view'); if(!state.measures.length){v.innerHTML=empty('Sem medições','Registre sua primeira medição para preencher esta área.');wireGo();return}
  v.innerHTML=`<div class="section-head"><div><h3>Medidas atuais</h3><p>Valores do último registro. Toque em uma medida para abrir a evolução.</p></div><button class="primary-btn" data-go="add">+ Registrar</button></div><div class="grid cols-3">${METRICS.map(metricCard).join('')}</div>`;
  $$('[data-metric]').forEach(c=>c.onclick=()=>{state.metric=c.dataset.metric;go('evolution')});wireGo()
}
function series(m){return state.measures.map(r=>({date:r.data,v:val(r,m)})).filter(x=>x.v!=null)}
function trendInfo(s){
  if(s.length<2)return {label:'Dados insuficientes',cls:'flat',desc:'É preciso outro registro para comparar datas.'};
  const a=s.at(-1).v,b=s.at(-2).v,d=+(a-b).toFixed(1),span=Math.abs(d); if(span<0.4)return{label:'Estável',cls:'flat',desc:'Os dois últimos valores estão próximos.'};
  return {label:d>0?'Aumento registrado':'Redução registrada',cls:d>0?'up':'low',desc:`Mudança de ${d>0?'+':''}${fmt(d)} entre os dois últimos registros.`};
}
function stallCard(s,m){
  try{
    const st=stallInfo(s,m); if(!st)return '';
    const sug=(m&&(m.u==='cm')&&m.k!=='cintura'&&m.k!=='abdomen')
      ? 'Se o objetivo é ganhar, é sinal de platô: troque a variação do exercício por ~3 semanas ou suba o volume gradualmente.'
      : (m&&(m.k==='cintura'||m.k==='abdomen'||m.k==='peso'))
      ? 'Se o objetivo é reduzir, o balanço parou: reavalie o déficit (calorias/passos) antes de cortar mais.'
      : 'Reavalie o estímulo: pequena mudança de protocolo costuma destravar.';
    return `<div class="notice" style="margin-top:14px">Estagnação em <b>${esc(m.l)}</b>: variação de apenas ${fmt(st.change)} ${m.u} em ${st.days} dias (desde ${fmtDate(st.base)}). ${sug}</div>`;
  }catch{return ''}
}
/* ===== Corpo-holograma (SVG) — explica onde medir e vira gráfico clicável ===== */
const PART_LABEL={pescoco:'Pescoço',ombros:'Ombros',peito:'Peitoral',cintura:'Cintura',abdomen:'Abdômen',quadril:'Quadril',biceps:'Bíceps',coxa:'Coxa',panturrilha:'Panturrilha'};
const FIELD_PART={pescoco:'pescoco',ombros:'ombros',peito:'peito',cintura:'cintura',abdomen:'abdomen',quadril:'quadril',bicepsD:'biceps',bicepsE:'biceps',coxaD:'coxa',coxaE:'coxa',panD:'panturrilha',panE:'panturrilha'};
// [key, tipo, y, (x1,x2 p/ linha) | (cx p/ anel)]
const BODY_PARTS=[
  ['pescoco','line',72,88,112],['ombros','line',98,56,144],['peito','line',120,72,128],
  ['cintura','line',164,82,118],['abdomen','line',184,80,120],['quadril','line',206,76,124],
  ['biceps','ring',150,160],['coxa','ring',270,126],['panturrilha','ring',360,124]
];
const BODY_HALF='M100,64 C109,64 115,66 117,73 C120,82 128,86 140,90 C152,94 162,101 166,114 C169,124 167,136 163,150 C160,164 157,178 154,192 C152,202 151,212 150,222 C149,228 146,230 143,227 C140,216 140,205 140,194 C140,180 142,165 137,151 C133,139 129,129 126,121 C124,133 124,149 121,163 C119,173 117,181 119,191 C121,201 125,206 127,215 C129,225 130,237 130,249 C129,271 126,289 124,313 C123,327 124,337 123,349 C122,363 123,379 121,399 C120,409 120,415 121,421 C127,422 130,423 129,427 L105,427 C104,400 106,360 105,300 C104,268 105,240 103,222 L100,220';
const BODY_MUSC=['M101,108 C117,109 129,113 135,122 C129,129 117,131 103,129','M123,99 C132,103 139,111 141,122','M101,131 L101,167','M101,141 L117,140','M101,152 L115,151','M101,163 L113,162','M119,131 C123,142 122,152 117,162','M149,120 C155,131 154,143 150,156','M115,232 C119,256 117,286 114,312','M125,250 C129,270 128,292 125,310','M117,332 C121,342 120,353 117,361'];
function bodyHologram(active,opts){
  opts=opts||{};const vals=opts.values||{},interactive=opts.mode==='evolution';
  const parts=BODY_PARTS.map(p=>{
    const k=p[0],type=p[1],y=p[2],on=k===active,lbl=PART_LABEL[k],v=vals[k];
    const label=`<text class="hot-lbl" x="${(type==='line'?p[4]:p[3])+(type==='line'?7:11)}" y="${y+3}">${lbl}${v?` · ${v}`:''}</text>`;
    if(type==='line'){const x1=p[3],x2=p[4];return `<g class="hot ${on?'on':''}" data-part="${k}"><line class="hot-line" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><circle class="hot-dot" cx="${x2}" cy="${y}" r="3.4"/>${label}</g>`}
    const cx=p[3];return `<g class="hot ${on?'on':''}" data-part="${k}"><circle class="hot-ring" cx="${cx}" cy="${y}" r="7"/><circle class="hot-dot" cx="${cx}" cy="${y}" r="3.4"/>${label}</g>`;
  }).join('');
  return `<svg class="body-holo ${interactive?'interactive':''}" viewBox="0 0 200 440" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mapa corporal">
   <defs><filter id="bhglow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
   <linearGradient id="bhg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#37e6ff"/><stop offset="1" stop-color="#7c5cff"/></linearGradient>
   <linearGradient id="bhfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#37e6ff" stop-opacity="0.05"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0.09"/></linearGradient></defs>
   <path d="${BODY_HALF}" fill="url(#bhfill)"/><path d="${BODY_HALF}" transform="matrix(-1,0,0,1,200,0)" fill="url(#bhfill)"/>
   <g filter="url(#bhglow)"><circle class="body-line" cx="100" cy="40" r="20"/><path class="body-line" d="M100,60 L100,64"/><path class="body-line" stroke-linecap="round" d="${BODY_HALF}"/><path class="body-line" stroke-linecap="round" d="${BODY_HALF}" transform="matrix(-1,0,0,1,200,0)"/></g>
   <g class="body-musc">${BODY_MUSC.map(d=>`<path d="${d}"/><path d="${d}" transform="matrix(-1,0,0,1,200,0)"/>`).join('')}</g>
   ${parts}</svg>`;
}
function highlightBodyPart(part){$$('.body-holo .hot').forEach(h=>h.classList.toggle('on',h.dataset.part===part))}
function evoInsight(){try{const ci=compositeInsight();if(!ci)return '';return `<div class="card pad" style="margin-top:14px;border-color:rgba(124,92,255,.22)"><span class="eyebrow">LEITURA</span><h3 style="font:700 15px var(--display);margin:7px 0 5px">${esc(ci.head)}</h3><p style="color:var(--muted);font-size:12px;line-height:1.65;margin:0">${esc(ci.body)}</p></div>`}catch{return ''}}
function renderEvolution(){
  const v=$('#view'); if(!state.measures.length){v.innerHTML=empty('Sem histórico para analisar','Registre uma medição para iniciar sua linha do tempo.');wireGo();return}
  const m=metric(state.metric)||METRICS[0],s=series(m),t=trendInfo(s),first=s[0]?.v,lastv=s.at(-1)?.v,total=first!=null&&lastv!=null?+(lastv-first).toFixed(1):null;
  const bodyVals={};BODY_PARTS.forEach(p=>{const mm=metric(p[0]);if(mm){const vv=val(last(),mm);if(vv!=null)bodyVals[p[0]]=fmt(vv)+(mm.u?(' '+mm.u):'')}});
  v.innerHTML=`<div class="card pad body-card"><span class="eyebrow">MAPA CORPORAL</span><div class="body-holo-wrap">${bodyHologram(m.k,{mode:'evolution',values:bodyVals})}</div><p class="body-hint">Toque numa parte do corpo para ver a evolução daquela medida.</p></div>
  <div class="card pad" style="margin-top:14px"><div class="seg">${METRICS.map(x=>`<button class="chip-btn ${x.k===m.k?'on':''}" data-m="${x.k}">${x.l}</button>`).join('')}</div></div>
  <div class="grid cols-3" style="margin-top:14px"><div class="card kpi"><div class="label">ATUAL</div><div class="value">${fmt(lastv)} ${m.u}</div><div class="meta">${fmtDate(s.at(-1)?.date)}</div></div><div class="card kpi"><div class="label">VARIAÇÃO TOTAL</div><div class="value">${total==null?'—':`${total>0?'+':''}${fmt(total)} ${m.u}`}</div><div class="meta">desde ${fmtDate(s[0]?.date)}</div></div><div class="card kpi"><div class="label">STATUS</div><div class="value" style="font-size:16px">${t.label}</div><div class="meta">${t.desc}</div></div></div>
  <div class="card chart-card" style="margin-top:14px"><div class="metric-top"><div><b style="font:700 14px var(--display)">${m.l}</b><div style="color:var(--muted);font-size:10px;margin-top:3px">${s.length} pontos registrados</div></div><span class="status-pill ${t.cls}">${t.label}</span></div><div class="chart-wrap">${lineChart(s,m.u)}</div></div>
  ${stallCard(s,m)}
  ${s.length<2?`<div class="card empty" style="margin-top:14px"><div class="empty-ic">2</div><h3>Falta uma segunda data</h3><p>Registre mais uma medição para calcular mudança entre períodos.</p><button class="primary-btn" data-go="add">Registrar nova medição</button></div>`:''}
  ${evoInsight()}`;
  $$('[data-m]').forEach(b=>b.onclick=()=>{state.metric=b.dataset.m;renderEvolution()});
  $$('.body-holo .hot').forEach(h=>h.onclick=()=>{state.metric=h.dataset.part;renderEvolution()});wireGo()
}
function lineChart(s,u){
  if(!s.length)return '<div class="empty">Sem pontos</div>'; const W=900,H=270,P=34,vals=s.map(x=>x.v),min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;
  const x=i=>P+(i/(Math.max(1,s.length-1)))*(W-P*2),y=v=>H-P-((v-min)/range)*(H-P*2); const pts=s.map((d,i)=>`${x(i)},${y(d.v)}`).join(' '),area=`${x(0)},${H-P} ${pts} ${x(s.length-1)},${H-P}`;
  const yLines=[0,.5,1].map(q=>{const yy=P+q*(H-P*2);return `<line class="chart-grid" x1="${P}" y1="${yy}" x2="${W-P}" y2="${yy}"/>`}).join('');
  const labels=s.map((d,i)=>i===0||i===s.length-1||i===Math.floor((s.length-1)/2)?`<text class="chart-label" x="${x(i)}" y="${H-8}" text-anchor="middle">${fmtDate(d.date).replace(/ de /g,' ')}</text>`:'').join('');
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c5cff" stop-opacity=".26"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></linearGradient></defs>${yLines}<polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${pts}"/>${s.map((d,i)=>`<circle class="chart-dot" cx="${x(i)}" cy="${y(d.v)}" r="4"><title>${fmtDate(d.date)}: ${fmt(d.v)}${u}</title></circle>`).join('')}${labels}</svg>`
}

function renderAdd(){
  const a=last()||{},h=state.profile.altura||a.altura||''; $('#view').innerHTML=`<form id="measureForm" class="form-shell"><div class="card form-card">
  ${formSection('Essenciais',`<div class="fields">${field('Data','data','date',today(),true)}${field('Peso (kg)','peso','number','',true,'0.1')}${field('Altura (cm)','altura','number',h,true,'0.5')}${field('Pescoço (cm)','pescoco','number','',true,'0.5')}</div>`)}
  ${formSection('Tronco',`<p class="form-help">Cintura: ponto mais estreito. Abdômen: altura do umbigo. Quadril: maior circunferência.</p><div class="fields">${field('Cintura (cm)','cintura','number','',false,'0.5')}${field('Abdômen (cm)','abdomen','number','',false,'0.5')}${field('Quadril (cm)','quadril','number','',false,'0.5')}${field('Peitoral (cm)','peito','number','',false,'0.5')}${field('Ombros (cm)','ombros','number','',false,'0.5')}</div>`)}
  ${formSection('Braços e pernas',`<div class="fields">${field('Bíceps D','bicepsD','number','',false,'0.5')}${field('Bíceps E','bicepsE','number','',false,'0.5')}${field('Antebraço D','antD','number','',false,'0.5')}${field('Antebraço E','antE','number','',false,'0.5')}${field('Coxa D','coxaD','number','',false,'0.5')}${field('Coxa E','coxaE','number','',false,'0.5')}${field('Panturrilha D','panD','number','',false,'0.5')}${field('Panturrilha E','panE','number','',false,'0.5')}</div>`)}
  ${formSection('Observações',`<div class="field"><label>Notas do registro</label><textarea name="notas" placeholder="Contexto do dia, horário, treino, retenção, observações..."></textarea></div>`)}
  <button class="primary-btn" type="submit" style="width:100%;margin-top:16px">Salvar medição</button></div>
  <aside class="card sticky-card"><span class="eyebrow">ONDE MEDIR</span><div class="body-holo-wrap sm">${bodyHologram(null,{mode:'add'})}</div><p class="body-hint">Toque num campo ao lado para acender o ponto exato. Cintura é o ponto mais estreito; abdômen na altura do umbigo; quadril na maior circunferência.</p><div class="calc-divider"></div><h3 style="font:700 16px var(--display);margin:2px 0 12px">Cálculos automáticos</h3><div id="liveCalc">${calcPreview({})}</div><p style="color:var(--muted2);font-size:9px;line-height:1.55;margin-top:14px">BF e FFMI são estimativas matemáticas baseadas nas medidas registradas. Use principalmente para acompanhar consistência ao longo do tempo.</p></aside></form>`;
  const f=$('#measureForm');f.oninput=()=>{const d=Object.fromEntries(new FormData(f));$('#liveCalc').innerHTML=calcPreview(d)};f.onsubmit=saveMeasure;
  f.addEventListener('focusin',e=>{const part=FIELD_PART[e.target.name];if(part)highlightBodyPart(part)})
}
function formSection(t,c){return `<section class="form-section"><h3>${t}</h3>${c}</section>`}
function field(l,n,t,v='',req=false,step=''){return `<div class="field"><label>${l}${req?' *':''}</label><input name="${n}" type="${t}" value="${esc(v)}" ${step?`step="${step}"`:''} ${req?'required':''} inputmode="${t==='number'?'decimal':'text'}"></div>`}
function calcPreview(d){const r=normalizeMeasure(d),bf=calcBF(r),lb=calcLBM(r),ff=calcFFMI(r),ratio=num(r.cintura)&&num(r.altura)?r.cintura/r.altura:null;return [['BF estimado',bf==null?'—':fmt(bf)+' %'],['Massa magra estimada',lb==null?'—':fmt(lb)+' kg'],['FFMI estimado',ff==null?'—':fmt(ff)],['Cintura / altura',ratio==null?'—':ratio.toFixed(2)]].map(x=>`<div class="calc-row"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('')}
async function saveMeasure(e){
  e.preventDefault();const raw=Object.fromEntries(new FormData(e.currentTarget));const r=normalizeMeasure({...raw,id:String(Date.now())});
  if(!r.data||!r.peso||!r.altura||!r.pescoco){toast('Preencha data, peso, altura e pescoço');return}
  state.measures.push(r);state.measures.sort((a,b)=>a.data.localeCompare(b.data));state.profile.altura=r.altura;saveCache();render();toast('Medição salva localmente');
  const res=await apiPost('upsert',r);if(res?.success){toast('Medição sincronizada');await syncAll(false);go('measures')}else{notice('A medição ficou salva neste dispositivo, mas ainda não foi enviada ao Google Sheets.')}
}

function renderHistory(){
  const v=$('#view');if(!state.measures.length){v.innerHTML=empty('Histórico vazio','Seus registros aparecerão aqui em ordem cronológica.');wireGo();return}
  v.innerHTML=`<div class="card pad"><div class="section-head" style="margin:0 0 12px"><div><h3>Consistência de registro</h3><p>Últimas ~12 semanas · cada quadrado é um dia</p></div><div class="action-row"><button class="ghost-btn" id="csvBtn">CSV</button><button class="ghost-btn" id="backupBtn">Backup</button></div></div>${calendarHeatmap()}</div>
  <div class="section-head"><div><h3>Linha do tempo</h3><p>${state.measures.length} registros</p></div></div><div class="card table-list">${[...state.measures].reverse().map(historyRow).join('')}</div>`;
  $('#csvBtn').onclick=exportCSV;$('#backupBtn').onclick=exportBackup;$$('[data-del]').forEach(b=>b.onclick=()=>deleteMeasure(b.dataset.del))
}
function historyRow(r){return `<div class="history-row"><div class="history-date"><b>${fmtDate(r.data)}</b><small>ID ${esc(r.id).slice(-6)}</small></div><div class="history-values"><span>Peso <b>${fmt(r.peso)}kg</b></span><span>Cintura <b>${fmt(num(r.cintura))}cm</b></span><span>Peito <b>${fmt(num(r.peito))}cm</b></span><span>Ombros <b>${fmt(num(r.ombros))}cm</b></span></div><button class="text-btn danger" data-del="${esc(r.id)}">Excluir</button></div>`}
function calendarCells(){const set=new Set(state.measures.map(r=>r.data)),out=[];for(let i=83;i>=0;i--){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-i);const k=d.toISOString().slice(0,10);out.push(`<div class="day ${set.has(k)?'on':''}" title="${fmtDate(k)}"></div>`)}return out.join('')}
function calendarHeatmap(){
  const set=new Set(state.measures.map(r=>r.data));
  const today=new Date();today.setHours(12,0,0,0);
  const start=new Date(today);start.setDate(start.getDate()-83);start.setDate(start.getDate()-start.getDay()); // recua ao domingo
  const weeks=[];let cur=new Date(start);
  while(cur<=today){const w=[];for(let d=0;d<7;d++){const k=cur.toISOString().slice(0,10);w.push({k,on:set.has(k),future:cur>today,mon:cur.getMonth()});cur=new Date(cur.getTime()+864e5)}weeks.push(w)}
  const MON=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  let lastMon=-1;const months=weeks.map(w=>{const m=w[0].mon;let lab='';if(m!==lastMon){lab=MON[m];lastMon=m}return `<span class="cal2-mon">${lab}</span>`}).join('');
  const DAYS=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const dayLabels=DAYS.map((d,i)=>`<span class="cal2-dl">${i%2===1?d:''}</span>`).join(''); // Seg/Qua/Sex visíveis
  const cols=weeks.map(w=>`<div class="cal2-week">${w.map(c=>`<div class="cal2-cell ${c.future?'future':c.on?'on':''}" title="${c.future?'':fmtDate(c.k)+(c.on?' · registrado':' · sem registro')}"></div>`).join('')}</div>`).join('');
  return `<div class="cal2"><div class="cal2-months">${months}</div><div class="cal2-body"><div class="cal2-days">${dayLabels}</div><div class="cal2-weeks">${cols}</div></div>
  <div class="cal2-legend"><i class="cal2-cell on"></i> dia com medição<span style="width:10px"></span><i class="cal2-cell"></i> sem registro</div></div>`;
}
async function deleteMeasure(id){if(!confirm('Excluir esta medição?'))return;state.measures=state.measures.filter(r=>String(r.id)!==String(id));saveCache();renderHistory();const res=await apiPost('delete',{id});if(res?.success)toast('Medição excluída');else toast('Excluída localmente')}
function exportCSV(){const h=['data','peso','altura','pescoco','cintura','abdomen','quadril','peito','ombros','bicepsD','bicepsE','antD','antE','coxaD','coxaE','panD','panE','notas'];const rows=[h.join(';'),...state.measures.map(r=>h.map(k=>String(r[k]??'').replaceAll(';',',')).join(';'))];download('physique-pro-medidas.csv',rows.join('\n'),'text/csv;charset=utf-8')}
function exportBackup(){download(`physique-pro-backup-${today()}.json`,JSON.stringify({version:2,exportedAt:new Date().toISOString(),measures:state.measures,routine:state.routine,profile:state.profile,scans:state.scans},null,2),'application/json')}
function download(name,txt,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}

let photoDB=null,scanDraft={front:null,side:null,back:null};
const scanSel={aId:null,bId:null,angle:'front',mode:'wipe',grid:false,wipe:50,fade:60};
const ANGLES=[['front','Frente'],['side','Lateral'],['back','Costas']];
const angleLabel=k=>({front:'Frente',side:'Lateral',back:'Costas'}[k]||k);
function openPhotoDB(){return new Promise(res=>{const q=indexedDB.open('physiqueProV2Photos',1);q.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains('sessions'))db.createObjectStore('sessions',{keyPath:'id'})};q.onsuccess=e=>{photoDB=e.target.result;res(photoDB)};q.onerror=()=>res(null)})}
async function photoAll(){if(!photoDB)await openPhotoDB();if(!photoDB)return[];return new Promise(res=>{const q=photoDB.transaction('sessions').objectStore('sessions').getAll();q.onsuccess=()=>res((q.result||[]).sort((a,b)=>b.date.localeCompare(a.date)));q.onerror=()=>res([])})}
async function photoPut(s){if(!photoDB)await openPhotoDB();if(!photoDB)return false;return new Promise(res=>{const q=photoDB.transaction('sessions','readwrite').objectStore('sessions').put(s);q.onsuccess=()=>res(true);q.onerror=()=>res(false)})}
async function photoDelete(id){if(!photoDB)await openPhotoDB();if(!photoDB)return false;return new Promise(res=>{const q=photoDB.transaction('sessions','readwrite').objectStore('sessions').delete(id);q.onsuccess=()=>res(true);q.onerror=()=>res(false)})}
function readPhoto(file){return new Promise(res=>{const fr=new FileReader();fr.onload=()=>{const im=new Image();im.onload=()=>{const max=1000,scale=Math.min(1,max/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*scale);c.height=Math.round(im.height*scale);c.getContext('2d').drawImage(im,0,0,c.width,c.height);res(c.toDataURL('image/jpeg',.82))};im.onerror=()=>res(null);im.src=fr.result};fr.onerror=()=>res(null);fr.readAsDataURL(file)})}
function scanHas(s,angle){return !!(s&&s[angle])}
function scanThumb(s){return s?(s.front||s.side||s.back||null):null}
async function renderScan(){
  const sessions=await photoAll();
  // garante seleção válida: B = mais recente, A = mais antiga (fallbacks seguros)
  const ids=sessions.map(s=>s.id);
  if(!ids.includes(scanSel.bId))scanSel.bId=ids[0]||null;
  if(!ids.includes(scanSel.aId))scanSel.aId=ids.length>1?ids[ids.length-1]:ids[0]||null;
  const slot=k=>`<label class="scan-tile">${scanDraft[k]?`<img src="${scanDraft[k]}"><span class="scan-guide"></span>`:`<div class="scan-placeholder"><b>${angleLabel(k)}</b>Adicionar foto</div><span class="scan-guide"></span>`}<input data-photo="${k}" type="file" accept="image/*" hidden></label>`;
  const compareBlock=sessions.length? scanCompareUI(sessions) : empty('Ainda sem comparação','Salve pelo menos uma sessão de fotos para iniciar o histórico.','scan','Continuar no Scan');
  $('#view').innerHTML=`<div class="card pad"><span class="eyebrow">SCAN VISUAL</span><h2 style="font:700 20px var(--display);margin:7px 0 7px">Fotos comparáveis, não medidas inventadas</h2><p style="color:var(--muted);font-size:11px;line-height:1.6;margin:0">Use a mesma distância, câmera e pose. A grade ajuda a repetir o enquadramento. As fotos ficam neste dispositivo.</p></div>
  <div class="section-head"><div><h3>Novo registro</h3><p>Frente, lateral e costas — mesma pose de sempre</p></div></div><div class="scan-grid">${slot('front')}${slot('side')}${slot('back')}</div><button class="primary-btn" id="saveScanBtn" style="margin-top:12px">Salvar sessão de fotos</button>
  <div class="section-head"><div><h3>Antes × Depois</h3><p>${sessions.length} ${sessions.length===1?'sessão salva':'sessões salvas'} · escolha as datas e o ângulo</p></div></div>${compareBlock}
  <div class="section-head"><div><h3>Todas as sessões</h3><p>Toque para usar como "depois". Exclua o que não precisar.</p></div></div>${scanGallery(sessions)}`;
  // eventos de captura e salvar
  $$('[data-photo]').forEach(i=>i.onchange=async()=>{const f=i.files?.[0];if(!f)return;toast('Processando foto…');scanDraft[i.dataset.photo]=await readPhoto(f);renderScan()});
  $('#saveScanBtn').onclick=saveScan;
  // seletores de comparação
  const selA=$('#scanA'),selB=$('#scanB');
  if(selA)selA.onchange=()=>{scanSel.aId=selA.value;renderScan()};
  if(selB)selB.onchange=()=>{scanSel.bId=selB.value;renderScan()};
  $$('[data-angle]').forEach(b=>b.onclick=()=>{scanSel.angle=b.dataset.angle;renderScan()});
  $$('[data-mode]').forEach(b=>b.onclick=()=>{scanSel.mode=b.dataset.mode;renderScan()});
  const gt=$('#gridToggle');if(gt)gt.onclick=()=>{scanSel.grid=!scanSel.grid;renderScan()};
  // sliders atualizam o DOM direto (sem re-render, pra não travar o arraste)
  const wr=$('#wipeRange');if(wr)wr.oninput=()=>{scanSel.wipe=+wr.value;const t=$('#wipeTop'),l=$('#wipeLine');if(t)t.style.clipPath=`inset(0 ${100-wr.value}% 0 0)`;if(l)l.style.left=wr.value+'%'};
  const fr=$('#fadeRange');if(fr)fr.oninput=()=>{scanSel.fade=+fr.value;const t=$('#fadeTop'),p=$('#fadePct');if(t)t.style.opacity=fr.value/100;if(p)p.textContent=fr.value+'%'};
  // galeria: usar como depois / excluir
  $$('[data-usea]').forEach(b=>b.onclick=()=>{scanSel.aId=b.dataset.usea;renderScan()});
  $$('[data-useb]').forEach(b=>b.onclick=()=>{scanSel.bId=b.dataset.useb;renderScan()});
  $$('[data-delsession]').forEach(b=>b.onclick=async()=>{if(!confirm('Excluir esta sessão de fotos? Não dá para desfazer.'))return;await photoDelete(b.dataset.delsession);toast('Sessão excluída');renderScan()});
}
function scanCompareUI(sessions){
  const a=sessions.find(s=>s.id===scanSel.aId),b=sessions.find(s=>s.id===scanSel.bId),angle=scanSel.angle;
  const opt=(sel)=>sessions.map(s=>`<option value="${esc(s.id)}" ${s.id===sel?'selected':''}>${fmtDate(s.date)}</option>`).join('');
  const angleChips=ANGLES.map(([k,l])=>`<button class="chip-btn ${scanSel.angle===k?'on':''}" data-angle="${k}">${l}</button>`).join('');
  const modeChips=`<button class="chip-btn ${scanSel.mode==='wipe'?'on':''}" data-mode="wipe">Cortina</button><button class="chip-btn ${scanSel.mode==='fade'?'on':''}" data-mode="fade">Transparência</button>`;
  const controls=`<div class="scan-controls">
    <div class="field"><label>Antes</label><select id="scanA">${opt(scanSel.aId)}</select></div>
    <div class="field"><label>Depois</label><select id="scanB">${opt(scanSel.bId)}</select></div>
  </div>
  <div class="scan-toolbar"><div class="seg">${angleChips}</div><div class="seg">${modeChips}</div><button class="chip-btn ${scanSel.grid?'on':''}" id="gridToggle">Grade ${scanSel.grid?'on':'off'}</button></div>`;
  const ai=a&&a[angle],bi=b&&b[angle];
  let viewer;
  if(!a||!b)viewer=`<div class="empty" style="padding:26px"><h3>Escolha duas sessões</h3><p>Selecione uma data em "Antes" e outra em "Depois".</p></div>`;
  else if(!ai||!bi){
    const faltando=[!ai?`"Antes" (${fmtDate(a.date)})`:null,!bi?`"Depois" (${fmtDate(b.date)})`:null].filter(Boolean).join(' e ');
    viewer=`<div class="empty" style="padding:26px"><h3>Sem foto de ${angleLabel(angle).toLowerCase()}</h3><p>${faltando} não tem foto desse ângulo. Troque o ângulo acima ou escolha outra sessão.</p></div>`;
  }else{
    const gridOv=scanSel.grid?`<span class="scan-grid-overlay"></span>`:'';
    if(scanSel.mode==='wipe'){
      viewer=`<div class="wipe-wrap"><img class="wipe-base" src="${ai}"><img id="wipeTop" class="wipe-top" src="${bi}" style="clip-path:inset(0 ${100-scanSel.wipe}% 0 0)"><span id="wipeLine" class="wipe-line" style="left:${scanSel.wipe}%"></span>${gridOv}<span class="wipe-tag left">Depois</span><span class="wipe-tag right">Antes</span></div>
      <input class="range" id="wipeRange" type="range" min="0" max="100" value="${scanSel.wipe}"><div class="scan-hint">Arraste para revelar o "depois" sobre o "antes".</div>`;
    }else{
      viewer=`<div class="overlay-wrap"><img src="${ai}"><img id="fadeTop" src="${bi}" style="opacity:${scanSel.fade/100}">${gridOv}</div>
      <div class="scan-fade-head"><span>Transparência do "depois"</span><b id="fadePct">${scanSel.fade}%</b></div><input class="range" id="fadeRange" type="range" min="0" max="100" value="${scanSel.fade}"><div class="scan-hint">Sobreponha as duas fotos para comparar contorno e enquadramento.</div>`;
    }
  }
  const gap=(a&&b&&a.date&&b.date)?Math.abs(Math.round((new Date(b.date+'T12:00:00')-new Date(a.date+'T12:00:00'))/864e5)):null;
  const gapTxt=gap!=null?`<div class="scan-gap">${fmtDate(a.date)} → ${fmtDate(b.date)} · ${gap} dia${gap===1?'':'s'} de intervalo</div>`:'';
  return `<div class="card pad">${controls}${gapTxt}${viewer}</div>`;
}
function scanGallery(sessions){
  if(!sessions.length)return '<div class="card pad"><div class="empty" style="padding:22px"><h3>Nenhuma foto ainda</h3><p>Salve sua primeira sessão acima.</p></div></div>';
  const cards=sessions.map(s=>{const t=scanThumb(s),angs=ANGLES.filter(([k])=>scanHas(s,k)).map(([,l])=>l).join(' · ')||'sem foto';
    const isA=s.id===scanSel.aId,isB=s.id===scanSel.bId;
    return `<div class="scan-card ${isA?'is-a':''} ${isB?'is-b':''}"><div class="scan-card-img">${t?`<img src="${t}">`:'<div class="scan-placeholder"><b>—</b></div>'}${isA?'<span class="scan-badge a">Antes</span>':''}${isB?'<span class="scan-badge b">Depois</span>':''}</div>
    <div class="scan-card-body"><b>${fmtDate(s.date)}</b><small>${angs}</small><div class="scan-card-actions"><button class="text-btn" data-usea="${esc(s.id)}">Usar como antes</button><button class="text-btn" data-useb="${esc(s.id)}">Depois</button><button class="text-btn danger" data-delsession="${esc(s.id)}">Excluir</button></div></div></div>`;
  }).join('');
  return `<div class="scan-gallery">${cards}</div>`;
}
async function saveScan(){if(!Object.values(scanDraft).some(Boolean)){toast('Adicione ao menos uma foto');return}const s={id:'scan_'+Date.now(),date:today(),...scanDraft};if(await photoPut(s)){scanDraft={front:null,side:null,back:null};scanSel.bId=s.id;toast('Sessão salva');apiPost('scan_upsert',{id:s.id,data:s.date,comparabilidade:Object.values(s).filter(v=>typeof v==='string'&&v.startsWith('data:image')).length,notas:'Fotos armazenadas localmente'});renderScan()}else toast('Não consegui salvar as fotos')}

function routineToday(){return state.routine.find(x=>String(x.data).slice(0,10)===today())||{data:today(),refeicoes:'',agua:'',sono:'',humor:'',energia:'',fome:'',digestao:'',primeiraRefeicao:'',ultimaRefeicao:'',notas:''}}
/* ===== Proteína do dia (quantidades -> gramas) ===== */
const PROT_ITEMS=[
  {k:'ovos',l:'Ovos',u:'un',p:6.3,step:1},
  {k:'whey',l:'Whey',u:'doses',p:24,step:1},
  {k:'albumina',l:'Albumina',u:'doses',p:24,step:1},
  {k:'frango',l:'Frango',u:'g',p:0.31,step:10},
  {k:'carne',l:'Carne vermelha',u:'g',p:0.27,step:10},
  {k:'feijao',l:'Feijão',u:'g',p:0.048,step:10},
  {k:'arroz',l:'Arroz integral',u:'g',p:0.026,step:10},
  {k:'aveia',l:'Aveia',u:'g',p:0.139,step:10}
];
function proteinFromRoutine(r){let t=0;PROT_ITEMS.forEach(it=>{const q=num(r&&r[it.k]);if(q!=null&&q>0)t+=q*it.p});return Math.round(t)}
function proteinGoal(){const w=num(last()?.peso);return w?Math.round(w*2):null}
function proteinSection(r){
  const total=proteinFromRoutine(r),goal=proteinGoal(),pct=goal?Math.min(100,Math.round(total/goal*100)):0;
  const rows=PROT_ITEMS.map(it=>{const q=r[it.k]||'',g=num(q)?Math.round(num(q)*it.p):0;
    return `<div class="prot-row"><label>${it.l} <small>(${it.u})</small></label><input class="prot-in" name="${it.k}" data-p="${it.p}" type="number" inputmode="decimal" step="${it.step}" min="0" value="${esc(q)}"><b class="prot-g" data-for="${it.k}">${g} g</b></div>`}).join('');
  return `<div class="prot-box"><div class="prot-head"><div><span class="eyebrow">PROTEÍNA DO DIA</span><div class="prot-total"><b id="protTotal">${total}</b><small> g${goal?` · meta ${goal} g (peso × 2)`:''}</small></div></div></div>${goal?`<div class="prot-bar"><span id="protFill" style="width:${pct}%"></span></div>`:''}<div class="prot-rows">${rows}</div><input type="hidden" name="proteinaTotal" id="protHidden" value="${total}"><p class="prot-note">Valores de proteína são aproximados por unidade/grama. O total soma tudo e compara com a meta.</p></div>`;
}
function recalcProtein(){let t=0;$$('.prot-in').forEach(inp=>{const q=num(inp.value),p=parseFloat(inp.dataset.p),b=$(`.prot-g[data-for="${inp.name}"]`);const g=(q!=null&&q>0)?q*p:0;if(b)b.textContent=Math.round(g)+' g';t+=g});const tot=Math.round(t),el=$('#protTotal');if(el)el.textContent=tot;const h=$('#protHidden');if(h)h.value=tot;const goal=proteinGoal(),fill=$('#protFill');if(fill&&goal)fill.style.width=Math.min(100,Math.round(tot/goal*100))+'%'}

/* ===== Tema claro/escuro ===== */
function currentTheme(){return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark'}
function applyTheme(t){const el=document.documentElement;if(t==='light')el.setAttribute('data-theme','light');else el.removeAttribute('data-theme');try{localStorage.setItem('ppv2_theme',t)}catch(e){}const tb=$('#themeBtn');if(tb)tb.textContent=t==='light'?'☾':'☀';}
function toggleTheme(){applyTheme(currentTheme()==='light'?'dark':'light')}

async function renderRoutine(){
  const r=routineToday(),last7=state.routine.filter(x=>(Date.now()-new Date(String(x.data).slice(0,10)+'T12:00:00'))/864e5<=7),avgW=mean(last7,'agua'),avgE=mean(last7,'energia');
  const recScore=recoveryFromRoutine(r),[recTxt,recCls,recDesc]=recoveryLabel(recScore),recPct=recScore==null?0:recScore;
  $('#view').innerHTML=`<div class="card hero" style="margin-bottom:14px"><div><span class="eyebrow">SCORE DE RECUPERAÇÃO</span><h2 style="font-size:23px">${esc(recTxt)}</h2><p>${esc(recDesc)} Combina sono, humor, energia, fome e digestão do registro de hoje.</p></div><div class="hero-ring" style="--pct:${recPct}%"><div><b>${recScore==null?'—':recScore}</b><small>HOJE</small></div></div></div>
  <div class="routine-summary"><div class="card kpi"><div class="label">DIAS REGISTRADOS</div><div class="value">${last7.length}/7</div><div class="meta">últimos 7 dias</div></div><div class="card kpi"><div class="label">ÁGUA MÉDIA</div><div class="value">${fmt(avgW)} L</div><div class="meta">quando registrado</div></div><div class="card kpi"><div class="label">ENERGIA MÉDIA</div><div class="value">${fmt(avgE)}</div><div class="meta">escala 1–5</div></div><div class="card kpi"><div class="label">TREINOS HEVY</div><div class="value">${state.hevy.length||'—'}</div><div class="meta">período carregado</div></div></div>
  <div class="section-head"><div><h3>Registro do dia</h3><p>Rotina alimentar e sensação geral, sem pontuação corporal.</p></div></div><form id="routineForm" class="card form-card"><div class="routine-form">${field('Primeira refeição','primeiraRefeicao','time',r.primeiraRefeicao||'')}${field('Última refeição','ultimaRefeicao','time',r.ultimaRefeicao||'')}${field('Nº de refeições','refeicoes','number',r.refeicoes||'')}${field('Água (L)','agua','number',r.agua||'',false,'0.1')}${field('Sono (h)','sono','number',r.sono||'',false,'0.5')}${field('Calorias gastas (kcal)','calorias','number',r.calorias||'',false,'10')}${selectField('Humor','humor',r.humor)}${selectField('Energia','energia',r.energia)}${selectField('Fome','fome',r.fome)}${selectField('Digestão','digestao',r.digestao)}</div>${proteinSection(r)}<div class="field" style="margin-top:10px"><label>Observações</label><textarea name="notas">${esc(r.notas||'')}</textarea></div><button class="primary-btn" style="margin-top:12px" type="submit">Salvar rotina do dia</button></form>
  <div class="section-head"><div><h3>Treinos recentes</h3><p>Leitura opcional do Hevy via Apps Script.</p></div><button class="ghost-btn" id="hevyBtn">Atualizar Hevy</button></div><div class="card pad hevy-list" id="hevyList">${hevyHTML()}</div>
  ${trainingAnalysisHTML()}`;
  $('#routineForm').onsubmit=saveRoutine;$('#routineForm').addEventListener('input',e=>{if(e.target.classList&&e.target.classList.contains('prot-in'))recalcProtein()});$('#hevyBtn').onclick=loadHevy
}
function mean(arr,k){const v=arr.map(x=>num(x[k])).filter(x=>x!=null);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null}
function selectField(l,n,v){return `<div class="field"><label>${l}</label><select name="${n}"><option value="">—</option>${[1,2,3,4,5].map(x=>`<option ${String(v)===String(x)?'selected':''}>${x}</option>`).join('')}</select></div>`}
async function saveRoutine(e){e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget)),r={...d,id:today(),data:today()};const i=state.routine.findIndex(x=>String(x.id)===today()||String(x.data).slice(0,10)===today());i>=0?state.routine[i]=r:state.routine.push(r);saveCache();toast('Rotina salva');const res=await apiPost('routine_upsert',r);if(res?.success)toast('Rotina sincronizada');renderRoutine()}
async function loadHevy(){toast('Consultando Hevy…');const d=await apiGet('hevy_workouts',{days:28});if(d?.success){state.hevy=d.workouts||d.registros||[];toast('Hevy atualizado');renderRoutine()}else toast(d?.error||'Hevy não disponível no backend')}
function hevyHTML(){if(!state.hevy.length)return '<div class="empty"><h3>Sem treinos carregados</h3><p>Se a chave do Hevy estiver configurada no Apps Script, toque em Atualizar Hevy.</p></div>';return state.hevy.slice(0,8).map(w=>`<div class="workout"><b>${esc(w.title||w.name||'Treino')}</b><small>${fmtDate(String(w.start_time||w.date||'').slice(0,10))} · ${w.exercises?.length||w.exercise_count||0} exercícios</small></div>`).join('')}
function trainingAnalysisHTML(){
  try{
    const vol=hevyVolume(); if(!vol)return '';
    // ordena grupos por séries/semana desc
    const rows=Object.keys(vol.perWeek).map(k=>({k,v:vol.perWeek[k],m:MUSCLE_META[k]})).filter(x=>x.m).sort((a,b)=>b.v-a.v);
    const bars=rows.map(x=>{
      const[,cls,hint]=volStatus(x.v,x.m),pct=Math.max(4,Math.min(100,(x.v/x.m.mrv)*100)),mevPct=Math.min(100,(x.m.mev/x.m.mrv)*100);
      return `<div class="vol-row"><div class="vol-head"><span>${esc(x.m.l)}</span><b>${fmt(x.v)}<small style="color:var(--muted);font-weight:600"> séries/sem</small></b></div>
      <div class="vol-track"><span class="vol-mev" style="left:${mevPct}%"></span><span class="vol-fill ${cls}" style="width:${pct}%"></span></div>
      <div class="vol-foot"><span class="status-pill ${cls}" style="padding:3px 7px">${hint}</span></div></div>`;
    }).join('');
    // push vs pull
    const p=vol.push,q=vol.pull,ratio=q>0?+(p/q).toFixed(2):(p>0?Infinity:null);
    let ppMsg='',ppCls='flat';
    if(ratio==null)ppMsg='Sem volume de empurrar/puxar identificado no período.';
    else if(!Number.isFinite(ratio)||ratio>=1.5){ppCls='low';ppMsg=`Empurrar ${fmt(p)} vs puxar ${fmt(q)} séries/sem (ratio ${Number.isFinite(ratio)?fmt(ratio,2):'—'}). Desbalanço a favor de empurrar — puxar mais protege o ombro.`;}
    else if(ratio<=0.6){ppCls='low';ppMsg=`Empurrar ${fmt(p)} vs puxar ${fmt(q)} séries/sem (ratio ${fmt(ratio,2)}). Puxar bem acima de empurrar.`;}
    else{ppCls='up';ppMsg=`Empurrar ${fmt(p)} vs puxar ${fmt(q)} séries/sem (ratio ${fmt(ratio,2)}) — equilíbrio saudável.`;}
    const deload=deloadSignal(vol);
    const deloadHTML=deload?`<div class="notice" style="margin-top:14px">Sinais de deload: ${esc(deload.join(' + '))}. Considere uma semana com ~40% menos volume (ou −10% de carga) para recuperar.</div>`:'';
    const rpeHTML=vol.rpeAvg!=null?`<span class="status-pill ${vol.rpeAvg>=8.7?'low':'flat'}" style="padding:4px 8px">RPE médio ${fmt(vol.rpeAvg)}</span>`:'<span class="status-pill flat" style="padding:4px 8px">RPE não registrado no Hevy</span>';
    return `<div class="section-head"><div><h3>Volume por grupo muscular</h3><p>${vol.workouts} treinos · ${vol.workSets} séries de trabalho · média em ${fmt(vol.weeks)} semana(s)</p></div>${rpeHTML}</div>
    <div class="card pad"><div class="vol-legend"><span><i class="dot up"></i>faixa produtiva</span><span><i class="dot low"></i>abaixo/acima</span><span><i class="mev-mark"></i>MEV mínimo</span></div>${bars}</div>
    <div class="card pad" style="margin-top:14px"><div class="metric-name" style="margin-bottom:6px">Empurrar × Puxar</div><span class="status-pill ${ppCls}" style="padding:5px 9px;display:inline-block;margin-bottom:8px">ratio ${Number.isFinite(ratio)?fmt(ratio,2):(ratio==null?'—':'∞')}</span><p style="color:var(--muted);font-size:11px;line-height:1.6;margin:0">${esc(ppMsg)}</p></div>
    ${deloadHTML}`;
  }catch{return ''}
}

/* ===== Contador de prancha ===== */
let plankInt=null,plankSec=0;
function plankFmt(s){s=Math.max(0,Math.round(s));const m=Math.floor(s/60);return `${m}:${String(s%60).padStart(2,'0')}`}
function plankBest(){try{const v=state.routine.map(x=>num(x.prancha)).filter(n=>n!=null&&n>0);return v.length?Math.max(...v):null}catch{return null}}
function plankTodaySec(){return num(routineToday().prancha)||0}
function stopPlank(){if(plankInt){clearInterval(plankInt);plankInt=null}}
async function mergeRoutineToday(patch){const i=state.routine.findIndex(x=>String(x.id)===today()||String(x.data).slice(0,10)===today());const base=i>=0?state.routine[i]:{id:today(),data:today()};const r={...base,...patch,id:today(),data:today()};i>=0?state.routine[i]=r:state.routine.push(r);saveCache();return apiPost('routine_upsert',r)}
function renderPlank(){
  const best=plankBest(),td=plankTodaySec();
  const hist=state.routine.filter(x=>num(x.prancha)>0).sort((a,b)=>String(b.data).localeCompare(String(a.data))).slice(0,6);
  plankSec=0;
  $('#view').innerHTML=`<div class="card pad" style="text-align:center"><span class="eyebrow">CONTADOR DE PRANCHA</span>
   <div class="plank-time" id="plankTime">0:00</div>
   <div class="plank-btns"><button class="primary-btn" id="plankToggle">Iniciar</button><button class="ghost-btn" id="plankReset">Zerar</button></div>
   <p class="body-hint">Segure a prancha e pare o cronômetro ao terminar. O melhor tempo do dia é salvo e sincronizado.</p></div>
   <div class="grid cols-2" style="margin-top:14px"><div class="card kpi"><div class="label">RECORDE</div><div class="value">${best?plankFmt(best):'—'}</div><div class="meta">seu maior tempo</div></div><div class="card kpi"><div class="label">HOJE</div><div class="value">${td?plankFmt(td):'—'}</div><div class="meta">melhor de hoje</div></div></div>
   ${hist.length?`<div class="section-head"><div><h3>Últimos registros</h3><p>Toque num dia para conferir</p></div></div><div class="card pad">${hist.map(x=>`<div class="plank-row"><span>${fmtDate(String(x.data).slice(0,10))}</span><b>${plankFmt(num(x.prancha))}</b></div>`).join('')}</div>`:''}`;
  const tog=$('#plankToggle');
  tog.onclick=async()=>{
    if(plankInt){stopPlank();
      if(plankSec>0&&plankSec>td){await mergeRoutineToday({prancha:plankSec});toast('Novo recorde do dia salvo!')}
      else if(plankSec>0)toast(`Tempo: ${plankFmt(plankSec)} (menor que o de hoje)`);
      renderPlank();
    }else{plankInt=setInterval(()=>{plankSec++;const el=$('#plankTime');if(el)el.textContent=plankFmt(plankSec)},1000);tog.textContent='Parar';tog.classList.add('rec')}
  };
  $('#plankReset').onclick=()=>{stopPlank();plankSec=0;renderPlank()};
}
/* ===== Contador de calorias (ingeridas) — local, funciona offline ===== */
const CAL_MEALS=[['cafe','Café da manhã','☀'],['almoco','Almoço','◐'],['jantar','Jantar','☾'],['lanche','Lanches','◦']];
const CAL_MACROS=[['protein','Proteína','#f43f5e','g'],['carbs','Carbo','#f59e0b','g'],['fat','Gordura','#3b82f6','g']];
const CAL_GOAL_DEF={calories:2000,protein:120,carbs:220,fat:60};
const FOODS=[
 {n:'Ovo (1un)',kcal:78,p:6.3,c:.6,f:5.3},{n:'Whey (1 dose)',kcal:120,p:24,c:3,f:1.5},{n:'Albumina (1 dose)',kcal:110,p:24,c:2,f:0},
 {n:'Frango (100g)',kcal:165,p:31,c:0,f:3.6},{n:'Carne vermelha (100g)',kcal:250,p:26,c:0,f:15},{n:'Tilápia (100g)',kcal:96,p:20,c:0,f:1.7},
 {n:'Atum (100g)',kcal:116,p:26,c:0,f:1},{n:'Feijão (100g)',kcal:76,p:4.8,c:14,f:.5},{n:'Arroz integral (100g)',kcal:111,p:2.6,c:23,f:.9},
 {n:'Arroz branco (100g)',kcal:130,p:2.7,c:28,f:.3},{n:'Aveia (30g)',kcal:117,p:4.2,c:20,f:2.3},{n:'Batata doce (100g)',kcal:86,p:1.6,c:20,f:.1},
 {n:'Banana (1un)',kcal:105,p:1.3,c:27,f:.4},{n:'Pão integral (fatia)',kcal:80,p:4,c:14,f:1},{n:'Leite (200ml)',kcal:120,p:6.6,c:9.6,f:6}
];
function calAll(){try{return JSON.parse(localStorage.getItem('ppv2_cal')||'{}')}catch{return{}}}
function calWrite(o){try{localStorage.setItem('ppv2_cal',JSON.stringify(o))}catch(e){}}
function calGoals(){try{return{...CAL_GOAL_DEF,...JSON.parse(localStorage.getItem('ppv2_cal_goals')||'{}')}}catch{return{...CAL_GOAL_DEF}}}
function calGoalsSet(g){try{localStorage.setItem('ppv2_cal_goals',JSON.stringify(g))}catch(e){}}
function calEntries(dk){return calAll()[dk]||[]}
function calAdd(dk,en){const all=calAll();(all[dk]=all[dk]||[]).push(en);calWrite(all)}
function calDel(dk,id){const all=calAll();all[dk]=(all[dk]||[]).filter(e=>e.id!==id);if(!all[dk].length)delete all[dk];calWrite(all)}
function calShift(delta){const d=new Date((state.calDate||today())+'T12:00:00');d.setDate(d.getDate()+delta);const k=d.toISOString().slice(0,10);if(k>today())return;state.calDate=k;state.calAdding=null;renderCalories()}
function renderCalories(){
  const dk=state.calDate||today();state.calDate=dk;
  const entries=calEntries(dk),goals=calGoals();
  const tot=entries.reduce((a,e)=>({calories:a.calories+(+e.calories||0),protein:a.protein+(+e.protein||0),carbs:a.carbs+(+e.carbs||0),fat:a.fat+(+e.fat||0)}),{calories:0,protein:0,carbs:0,fat:0});
  const remaining=Math.round(goals.calories-tot.calories),over=tot.calories>goals.calories;
  const R=54,C=2*Math.PI*R,off=C*(1-Math.min(goals.calories>0?tot.calories/goals.calories:0,1));
  const isToday=dk===today();
  const label=(()=>{const y=new Date(Date.now()-864e5).toISOString().slice(0,10);if(dk===today())return 'Hoje';if(dk===y)return 'Ontem';return fmtDate(dk)})();
  const ring=`<svg width="150" height="150" viewBox="0 0 150 150"><circle cx="75" cy="75" r="${R}" fill="none" stroke="var(--panel3)" stroke-width="13"/><circle cx="75" cy="75" r="${R}" fill="none" stroke="${over?'#f43f5e':'var(--cyan)'}" stroke-width="13" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 75 75)"/><text x="75" y="72" text-anchor="middle" style="font:800 30px var(--display);fill:var(--text)">${Math.abs(remaining)}</text><text x="75" y="90" text-anchor="middle" style="font:600 10px var(--font);fill:var(--muted)">${over?'ACIMA':'RESTANTES'}</text></svg>`;
  const macros=CAL_MACROS.map(([k,l,c])=>{const cons=Math.round(tot[k]),g=goals[k],pc=g>0?Math.min(100,cons/g*100):0;return `<div class="cal-macro"><div class="cal-macro-top"><span>${l}</span><b>${cons}<small>/${g}g</small></b></div><div class="cal-macro-bar"><span style="width:${pc}%;background:${c}"></span></div></div>`}).join('');
  const meals=CAL_MEALS.map(([mid,ml,mi])=>{
    const its=entries.filter(e=>e.meal===mid),sub=its.reduce((a,e)=>a+(+e.calories||0),0);
    const rows=its.map(e=>`<div class="cal-item"><div><b>${esc(e.name)}</b><small>${e.protein||0}p · ${e.carbs||0}c · ${e.fat||0}g</small></div><div class="cal-item-r"><span>${Math.round(e.calories)} kcal</span><button class="cal-del" data-del="${esc(e.id)}" aria-label="Remover">✕</button></div></div>`).join('');
    const form=state.calAdding===mid?`<div class="cal-form"><div class="cal-foods">${FOODS.map((fd,i)=>`<button type="button" class="cal-food" data-food="${i}">${esc(fd.n)}</button>`).join('')}</div><input id="cf-name" placeholder="Alimento (ex: Arroz, 100g)" type="text"><div class="cal-form-row"><input id="cf-kcal" placeholder="kcal" type="number" inputmode="numeric"><input id="cf-p" placeholder="prot" type="number" inputmode="numeric"><input id="cf-c" placeholder="carb" type="number" inputmode="numeric"><input id="cf-f" placeholder="gord" type="number" inputmode="numeric"></div><div class="cal-form-btns"><button class="primary-btn" id="cf-save" data-meal="${mid}">Adicionar</button><button class="ghost-btn" id="cf-cancel">Cancelar</button></div></div>`:'';
    return `<div class="card pad cal-meal"><div class="cal-meal-head"><div class="cal-meal-t"><span class="cal-meal-ic">${mi}</span>${ml}</div><b>${Math.round(sub)} kcal</b></div>${rows||'<p class="cal-empty">Nada registrado</p>'}${form}${state.calAdding===mid?'':`<button class="cal-addbtn" data-add="${mid}">+ Adicionar item</button>`}</div>`;
  }).join('');
  const goalsForm=state.calAdding==='goals'?`<div class="card pad"><div class="section-head" style="margin:0 0 10px"><div><h3>Metas diárias</h3></div></div><div class="cal-goals"><label>Calorias<input id="cg-cal" type="number" value="${goals.calories}"></label><label>Proteína<input id="cg-p" type="number" value="${goals.protein}"></label><label>Carbo<input id="cg-c" type="number" value="${goals.carbs}"></label><label>Gordura<input id="cg-f" type="number" value="${goals.fat}"></label></div><div class="cal-form-btns" style="margin-top:12px"><button class="primary-btn" id="cg-save">Salvar metas</button><button class="ghost-btn" id="cg-cancel">Cancelar</button></div></div>`:'';
  $('#view').innerHTML=`<div class="card pad"><div class="cal-daynav"><button class="cal-arrow" id="cal-prev">‹</button><b>${label}</b><button class="cal-arrow" id="cal-next" ${isToday?'disabled':''}>›</button></div>
   <div class="cal-hero">${ring}<div class="cal-hero-side">${macros}<div class="cal-consumed">${Math.round(tot.calories)} de ${goals.calories} kcal</div></div></div>
   <button class="ghost-btn" id="cal-goalsbtn" style="width:100%;margin-top:12px">Ajustar metas</button></div>
   ${goalsForm}
   <div class="cal-meals">${meals}</div>`;
  $('#cal-prev').onclick=()=>calShift(-1);
  const nx=$('#cal-next');if(nx&&!isToday)nx.onclick=()=>calShift(1);
  $('#cal-goalsbtn').onclick=()=>{state.calAdding=state.calAdding==='goals'?null:'goals';renderCalories()};
  $$('[data-add]').forEach(b=>b.onclick=()=>{state.calAdding=b.dataset.add;renderCalories()});
  $$('[data-del]').forEach(b=>b.onclick=()=>{calDel(dk,b.dataset.del);renderCalories()});
  const cancel=$('#cf-cancel');if(cancel)cancel.onclick=()=>{state.calAdding=null;renderCalories()};
  $$('[data-food]').forEach(b=>b.onclick=()=>{const fd=FOODS[+b.dataset.food];if(!fd)return;$('#cf-name').value=fd.n;$('#cf-kcal').value=fd.kcal;$('#cf-p').value=fd.p;$('#cf-c').value=fd.c;$('#cf-f').value=fd.f});
  const save=$('#cf-save');if(save)save.onclick=()=>{const name=($('#cf-name').value||'').trim(),kcal=num($('#cf-kcal').value);if(!name||kcal==null){toast('Informe nome e calorias');return}calAdd(dk,{id:'c'+Date.now()+Math.random().toString(36).slice(2,6),meal:save.dataset.meal,name,calories:Math.max(0,Math.round(kcal)),protein:Math.max(0,Math.round(num($('#cf-p').value)||0)),carbs:Math.max(0,Math.round(num($('#cf-c').value)||0)),fat:Math.max(0,Math.round(num($('#cf-f').value)||0))});state.calAdding=null;toast('Adicionado');renderCalories()};
  const gsave=$('#cg-save');if(gsave)gsave.onclick=()=>{calGoalsSet({calories:Math.max(0,Math.round(num($('#cg-cal').value)||CAL_GOAL_DEF.calories)),protein:Math.max(0,Math.round(num($('#cg-p').value)||0)),carbs:Math.max(0,Math.round(num($('#cg-c').value)||0)),fat:Math.max(0,Math.round(num($('#cg-f').value)||0))});state.calAdding=null;toast('Metas salvas');renderCalories()};
  const gcancel=$('#cg-cancel');if(gcancel)gcancel.onclick=()=>{state.calAdding=null;renderCalories()};
}
function renderSettings(){
  $('#view').innerHTML=`<div class="settings-grid"><div class="card settings-card"><h3>Banco de dados</h3><div class="field"><label>URL do Apps Script (/exec)</label><input id="apiInput" value="${esc(state.apiUrl)}"></div><div class="action-row" style="margin-top:10px"><button class="primary-btn" id="saveApi">Salvar e testar</button><button class="ghost-btn" id="syncNow">Sincronizar</button></div><p>Compatível com o backend antigo (get/upsert) e com o banco novo (bootstrap + datasets).</p></div>
  <div class="card settings-card"><h3>Perfil</h3><div class="field"><label>Altura fixa (cm)</label><input id="heightInput" type="number" step="0.5" value="${esc(state.profile.altura||last()?.altura||'')}"></div><button class="primary-btn" id="saveProfile" style="margin-top:10px">Salvar perfil</button></div>
  <div class="card settings-card"><h3>Backup</h3><p>Exporte medidas, rotina, perfil e metadados. As fotos continuam no IndexedDB do dispositivo.</p><div class="action-row"><button class="ghost-btn" id="exportBtn">Exportar JSON</button><button class="ghost-btn" id="importBtn">Importar JSON</button></div></div>
  <div class="card settings-card"><h3>Instalação</h3><p>Esta V2 já inclui manifest e service worker. Quando o navegador permitir, você poderá instalar o Physique Pro como PWA.</p><button class="primary-btn" id="installBtn" ${state.installPrompt?'':'disabled'}>Instalar aplicativo</button></div>
  <div class="card settings-card"><h3>Aparência</h3><p>Tema da interface. A escolha fica salva neste dispositivo.</p><div class="action-row"><button class="ghost-btn" id="themeDark">Escuro</button><button class="ghost-btn" id="themeLight">Claro</button></div></div></div>`;
  $('#saveApi').onclick=async()=>{const u=$('#apiInput').value.trim();if(!/\/exec/.test(u)){toast('Use a URL que termina em /exec');return}state.apiUrl=u;localStorage.setItem(LS.api,u);await syncAll(true)};$('#syncNow').onclick=()=>syncAll(true);
  $('#saveProfile').onclick=async()=>{state.profile.altura=num($('#heightInput').value);saveCache();const res=await apiPost('profile_upsert',{id:'main',altura:state.profile.altura,reminderInterval:state.profile.reminderInterval,reminderTime:state.profile.reminderTime});toast(res?.success?'Perfil sincronizado':'Perfil salvo localmente')};
  $('#themeDark').onclick=()=>applyTheme('dark');$('#themeLight').onclick=()=>applyTheme('light');
  $('#exportBtn').onclick=exportBackup;$('#importBtn').onclick=()=>$('#importInput').click();$('#installBtn').onclick=installPWA
}
async function importBackup(file){try{const d=JSON.parse(await file.text());if(Array.isArray(d.measures))state.measures=d.measures.map(normalizeMeasure);if(Array.isArray(d.routine))state.routine=d.routine;if(d.profile)state.profile=Object.assign(state.profile,d.profile);if(Array.isArray(d.scans))state.scans=d.scans;saveCache();toast('Backup importado');render()}catch{toast('Arquivo de backup inválido')}}
async function installPWA(){if(!state.installPrompt)return;state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;renderSettings()}

function boot(){
  applyTheme(localStorage.getItem('ppv2_theme')||'dark');
  loadCache();buildNav();$('#syncBtn').onclick=()=>syncAll(true);$('#quickAddBtn').onclick=()=>go('add');$('#importInput').onchange=e=>e.target.files?.[0]&&importBackup(e.target.files[0]);
  const tb=$('#themeBtn');if(tb)tb.onclick=toggleTheme;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e});
  if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  render();syncAll(false);
}

document.addEventListener('DOMContentLoaded',boot);
})();
