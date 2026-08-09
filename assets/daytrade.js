(()=>{
  const q=id=>document.getElementById(id);
  const MODE_KEY='money3-mode-v2';
  const CACHE_KEY='money3-intra-cache-v2';
  const INTRA_CACHE=new Map();
  const INTRA_TTL=120*1000;
  const STALE_TTL=12*60*60*1000;
  let dtChart=null;
  let renderArgs=null;
  let requestSeq=0;

  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:NaN;
  const fmt=(n,d=2)=>Number.isFinite(n)?Number(n).toLocaleString('zh-TW',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
  const money=(n,c)=>`${c==='TWD'?'NT$':c==='USD'?'US$':''}${fmt(n,0)}`;
  const isTw=s=>/\.(TW|TWO)$/.test(String(s||''));
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  function getMode(){return localStorage.getItem(MODE_KEY)||localStorage.getItem('money3-mode-v1')||'swing'}
  function setMode(mode){
    localStorage.setItem(MODE_KEY,mode);
    document.body.classList.toggle('daytrade-mode',mode==='daytrade');
    document.querySelectorAll('.trade-mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
    const hint=q('tradeModeHint');
    if(hint)hint.textContent=mode==='daytrade'?'5 分鐘線 · VWAP · OR15 · 當日清倉':'日線 · 多因子 · 分批進出';
    const p=q('daytradePanel');if(p)p.hidden=mode!=='daytrade';
    const s=q('bestStrategyPanel');if(s)s.hidden=mode==='daytrade';
    if(mode==='daytrade'&&renderArgs){
      renderDaytrade(...renderArgs);
      setTimeout(()=>q('daytradePanel')?.scrollIntoView({behavior:'smooth',block:'start'}),80);
    }
  }

  function ensureModeSwitch(){
    if(q('tradeModeSwitch'))return;
    const command=document.querySelector('.command-card');if(!command)return;
    const row=document.createElement('div');
    row.id='tradeModeSwitch';
    row.className='trade-mode-row';
    row.innerHTML=`<div class="trade-mode-copy"><span>分析模式</span><b id="tradeModeHint">—</b></div><div class="trade-mode-buttons"><button type="button" class="trade-mode-btn" data-mode="swing">波段</button><button type="button" class="trade-mode-btn" data-mode="daytrade">當沖</button></div>`;
    const quick=command.querySelector('.quick-row');
    quick?command.insertBefore(row,quick):command.appendChild(row);
    row.addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(b)setMode(b.dataset.mode)});
    setMode(getMode());
  }

  function ensurePanel(){
    if(q('daytradePanel'))return q('daytradePanel');
    const anchor=q('riskNotice')||q('dashboard')?.firstElementChild;if(!anchor)return null;
    const el=document.createElement('article');
    el.id='daytradePanel';el.className='panel daytrade-panel';el.hidden=true;
    el.innerHTML=`
      <div class="daytrade-head">
        <div class="dt-title-wrap"><span class="overline">INTRADAY ENGINE · 5M</span><h3><span id="dtSymbol">—</span> · 當沖模式</h3><small id="dtHeadline">只看今天需要的盤中訊號</small></div>
        <div class="daytrade-badges"><span id="dtSession" class="pill">待掃描</span><span id="dtScore" class="pill">5m</span><button id="dtRefresh" class="ghost small" type="button">↻ 更新</button></div>
      </div>
      <div id="dtLoading" class="daytrade-loading">
        <div class="dt-loading-main"><i class="dt-pulse"></i><div><b id="dtLoadingTitle">準備盤中引擎</b><span id="dtLoadingText">切換到當沖模式後，自動抓取最近 1 日 5 分鐘線。</span></div></div>
        <div class="dt-loading-steps"><span class="active">5m 行情</span><span>VWAP / OR15</span><span>風險部位</span></div>
      </div>
      <div id="dtBody" hidden>
        <div id="dtAlert" class="dt-alert"></div>
        <div class="dt-context-strip">
          <div><span>日線背景</span><b id="dtDailyTrend">—</b></div><div><span>日線分數</span><b id="dtDailyScore">—</b></div><div><span>模型信心</span><b id="dtDailyConfidence">—</b></div><div><span>日線現價</span><b id="dtDailyPrice">—</b></div>
        </div>
        <div class="dt-decision-grid">
          <div class="dt-hero"><span>盤中方向</span><b id="dtDirection">—</b><small id="dtDirectionText">—</small></div>
          <div class="dt-stat"><span>建議投入</span><b id="dtAmount">—</b><small id="dtShares">—</small></div>
          <div class="dt-stat"><span>進場觸發</span><b id="dtEntry">—</b><small id="dtEntryText">—</small></div>
          <div class="dt-stat"><span>硬停損</span><b id="dtStop">—</b><small id="dtRisk">—</small></div>
          <div class="dt-stat"><span>最晚清倉</span><b id="dtExitTime">—</b><small>不留隔夜部位</small></div>
        </div>
        <div class="dt-main-grid">
          <section class="dt-chart-card"><div class="dt-card-head"><div><span>5 分鐘走勢</span><b id="dtChartTitle">—</b></div><span id="dtSource">—</span></div><div class="dt-chartbox"><canvas id="dtChart"></canvas><div id="dtChartFallback" class="chart-fallback" hidden>圖表元件無法載入，但盤中指標仍可使用。</div></div></section>
          <section class="dt-plan-card"><div class="dt-card-head"><div><span>執行計畫</span><b>條件不到就不下單</b></div></div><div id="dtPlanRows" class="dt-plan-rows"></div></section>
        </div>
        <div class="dt-metrics" id="dtMetrics"></div>
        <details class="dt-rules-details"><summary>交易規則與資格提醒</summary><div class="dt-rules"><div><b>開盤規則</b><span id="dtOpenRule">—</span></div><div><b>退出規則</b><span id="dtExitRule">—</span></div><div><b>資格提醒</b><span id="dtEligibility">—</span></div></div></details>
        <div class="dt-foot">5 分鐘行情可能延遲或受公開來源限制；下單前仍應以券商即時報價、可當沖標的與帳戶資格為準。</div>
      </div>`;
    anchor.insertAdjacentElement('afterend',el);
    q('dtRefresh')?.addEventListener('click',()=>{if(renderArgs)renderDaytrade(...renderArgs,{force:true})});
    return el;
  }

  function readPersisted(key){
    try{const all=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}'),item=all[key];if(!item?.ts||!item?.data?.rows?.length)return null;const age=Date.now()-item.ts;if(age>STALE_TTL)return null;const data={...item.data,rows:item.data.rows.map(r=>({...r,t:new Date(r.t)})),fromLocalCache:true,stale:age>INTRA_TTL};return {ts:item.ts,data}}catch{return null}
  }
  function writePersisted(key,data){
    try{const all=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}');all[key]={ts:Date.now(),data:{...data,rows:data.rows.map(r=>({...r,t:new Date(r.t).toISOString()}))}};const trimmed=Object.fromEntries(Object.entries(all).sort((a,b)=>(b[1]?.ts||0)-(a[1]?.ts||0)).slice(0,6));localStorage.setItem(CACHE_KEY,JSON.stringify(trimmed))}catch{}
  }

  async function fetchText(url,timeout=6000){
    const routes=[url,`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`];let err;
    for(const u of routes){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeout);try{const r=await fetch(u,{cache:'no-store',signal:ctl.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);const t=await r.text();if(!t)throw new Error('空白回應');return t}catch(e){err=e?.name==='AbortError'?new Error('連線逾時'):e}finally{clearTimeout(timer)}}throw err||new Error('5 分鐘行情無回應');
  }
  function parseYahoo5m(text,key,rangeUsed){
    const j=JSON.parse(text),r=j?.chart?.result?.[0];if(!r)throw new Error(j?.chart?.error?.description||'無 5 分鐘資料');const qte=r.indicators?.quote?.[0];if(!qte||!r.timestamp)throw new Error('5 分鐘資料格式不完整');const tz=isTw(key)?'Asia/Taipei':'America/New_York';const rows=r.timestamp.map((t,i)=>({t:new Date(t*1000),open:qte.open[i],high:qte.high[i],low:qte.low[i],close:qte.close[i],volume:qte.volume[i]||0})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));if(rows.length<6)throw new Error('5 分鐘資料不足');return {symbol:key,meta:r.meta||{},tz,rows,source:`Yahoo Finance 5m · ${rangeUsed}`,stale:false};
  }
  async function loadIntraday(symbol,{force=false}={}){
    const key=String(symbol).toUpperCase(),mem=INTRA_CACHE.get(key);if(!force&&mem&&Date.now()-mem.ts<INTRA_TTL)return mem.data;const persisted=readPersisted(key);if(!force&&persisted&&!persisted.data.stale){INTRA_CACHE.set(key,persisted);return persisted.data}
    let lastErr;const attempts=[{host:'query1.finance.yahoo.com',range:'1d',timeout:5200},{host:'query2.finance.yahoo.com',range:'1d',timeout:5200},{host:'query1.finance.yahoo.com',range:'5d',timeout:6800},{host:'query2.finance.yahoo.com',range:'5d',timeout:6800}];
    for(const a of attempts){try{const url=`https://${a.host}/v8/finance/chart/${encodeURIComponent(key)}?range=${a.range}&interval=5m&includePrePost=false&events=div%2Csplits`;const data=parseYahoo5m(await fetchText(url,a.timeout),key,a.range),item={ts:Date.now(),data};INTRA_CACHE.set(key,item);writePersisted(key,data);return data}catch(e){lastErr=e;await sleep(90)}}
    if(persisted){const data={...persisted.data,stale:true,source:'5m 快取備援'};INTRA_CACHE.set(key,{ts:persisted.ts,data});return data}throw new Error(`5 分鐘行情連線失敗（${lastErr?.message||'來源暫時無回應'}）`);
  }

  function localParts(date,tz){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,min:(+p.hour)*60+(+p.minute),label:`${p.hour}:${p.minute}`}}
  function ema(values,p){const k=2/(p+1);let e=values[0];return values.map((v,i)=>e=i?e+(v-e)*k:v)}
  function atr(rows,p=14){const tr=rows.map((r,i)=>i?Math.max(r.high-r.low,Math.abs(r.high-rows[i-1].close),Math.abs(r.low-rows[i-1].close)):r.high-r.low);return tr.length<p?avg(tr):avg(tr.slice(-p))}
  function sessionAnalysis(data,daily,capital,riskPct,maxAlloc){
    const tw=isTw(data.symbol),openMin=tw?540:570,closeMin=tw?810:960;const tagged=data.rows.map(r=>({...r,...localParts(r.t,data.tz)})).filter(r=>r.min>=openMin&&r.min<=closeMin);const latest=[...new Set(tagged.map(r=>r.date))].sort().at(-1),rows=tagged.filter(r=>r.date===latest);if(rows.length<6)throw new Error('最近交易日 5 分鐘資料不足');
    const closes=rows.map(x=>x.close),e9=ema(closes,9),e21=ema(closes,21);let pv=0,vv=0;const vwap=rows.map(r=>{const tp=(r.high+r.low+r.close)/3;pv+=tp*r.volume;vv+=r.volume;return vv?pv/vv:r.close});const orRows=rows.filter(r=>r.min<openMin+15).slice(0,3),orHigh=Math.max(...orRows.map(x=>x.high)),orLow=Math.min(...orRows.map(x=>x.low));const current=rows.at(-1).close,lastVwap=vwap.at(-1),lastE9=e9.at(-1),lastE21=e21.at(-1),atr5=Math.max(atr(rows),current*.0015),volBase=avg(rows.slice(-21,-1).map(x=>x.volume).filter(Number.isFinite))||1,relVol=rows.at(-1).volume/volBase;
    let score=50;score+=current>lastVwap?13:-13;score+=lastE9>lastE21?12:-12;score+=current>orHigh?10:current<orLow?-10:0;score+=relVol>=1.25?(current>lastVwap?7:-7):0;score+=daily?.tech>=65?6:daily?.tech<=35?-6:0;score=clamp(Math.round(score),0,100);
    const now=localParts(new Date(),data.tz),sameSession=latest===now.date,currentSession=sameSession&&now.min>=openMin+15&&now.min<closeMin-10&&!data.stale,beforeWindow=sameSession&&now.min<openMin+15,afterWindow=sameSession&&now.min>=closeMin-10,sessionStatus=currentSession?'盤中':beforeWindow?'開盤準備':afterWindow?'已收盤':'非交易時段',historical=!currentSession;
    const longOk=score>=68&&current>lastVwap&&lastE9>lastE21,weak=score<=38&&current<lastVwap&&lastE9<lastE21,direction=historical?'準備模式':longOk?'多方當沖':weak?'偏空觀望':'等待突破';const riskCap=Math.min(Math.max(+riskPct||.5,.1),.75),riskBudget=capital*(riskCap/100),stopDist=clamp(Math.max(atr5*1.2,current*.003),current*.0025,current*.012),sharesRisk=Math.floor(riskBudget/stopDist),sharesAlloc=Math.floor((capital*(maxAlloc/100))/current);let shares=Math.max(0,Math.min(sharesRisk,sharesAlloc)),twLotBlocked=false;if(tw){shares=Math.floor(shares/1000)*1000;if(shares<1000)twLotBlocked=true}
    const active=longOk&&currentSession&&!twLotBlocked,entry=Math.max(lastVwap,lastE9),stop=Math.max(.01,entry-stopDist),tp1=entry+stopDist*1.1,tp2=entry+stopDist*1.8,amount=shares*entry,maxLoss=shares*stopDist,forceExit=tw?'13:20 前':'15:50 ET 前',entryWindow=tw?'09:15–11:30':'09:45–12:00 ET';return {rows,e9,e21,vwap,current,lastVwap,lastE9,lastE21,orHigh,orLow,atr5,relVol,score,historical,currentSession,sessionStatus,longOk,weak,direction,riskCap,riskBudget,stopDist,shares,twLotBlocked,active,entry,stop,tp1,tp2,amount,maxLoss,sessionLabel:latest,forceExit,entryWindow,tw,source:data.source,stale:!!data.stale};
  }

  function drawDtChart(a){
    if(dtChart){try{dtChart.destroy()}catch{}dtChart=null}const canvas=q('dtChart'),fallback=q('dtChartFallback');if(typeof Chart==='undefined'){if(canvas)canvas.hidden=true;if(fallback)fallback.hidden=false;return}canvas.hidden=false;if(fallback)fallback.hidden=true;const labels=a.rows.map(r=>r.label),orH=labels.map(()=>a.orHigh),orL=labels.map(()=>a.orLow);dtChart=new Chart(canvas,{type:'line',data:{labels,datasets:[{label:'價格',data:a.rows.map(r=>r.close),borderColor:'#edf5ff',borderWidth:2.2,pointRadius:0,tension:.08},{label:'VWAP',data:a.vwap,borderColor:'#54d6e8',borderWidth:1.5,pointRadius:0},{label:'EMA9',data:a.e9,borderColor:'#69a7ff',borderWidth:1.25,pointRadius:0},{label:'EMA21',data:a.e21,borderColor:'#a78bfa',borderWidth:1.25,pointRadius:0},{label:'OR15 High',data:orH,borderColor:'#4be5a4',borderWidth:1,pointRadius:0,borderDash:[5,5]},{label:'OR15 Low',data:orL,borderColor:'#ff6f7e',borderWidth:1,pointRadius:0,borderDash:[5,5]}]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:150},interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',labels:{color:'#9dafc9',boxWidth:10,font:{size:9}}}},scales:{x:{ticks:{color:'#617391',maxTicksLimit:6,maxRotation:0},grid:{display:false}},y:{ticks:{color:'#617391',maxTicksLimit:6},grid:{color:'rgba(70,90,120,.08)'}}}}});
  }
  function metric(label,value,cls=''){return `<div class="dt-metric"><span>${label}</span><b class="${cls}">${value}</b></div>`}
  function setLoadState(title,text,step=0){if(q('dtLoadingTitle'))q('dtLoadingTitle').textContent=title;if(q('dtLoadingText'))q('dtLoadingText').textContent=text;q('dtLoading')?.querySelectorAll('.dt-loading-steps span').forEach((s,i)=>s.classList.toggle('active',i<=step))}
  function renderResult(data,daily,a,capital){
    q('dtLoading').hidden=true;q('dtBody').hidden=false;q('dtSymbol').textContent=data.symbol;q('dtHeadline').textContent=a.currentSession?'盤中資料已同步，依條件執行':'目前不在可執行盤中時段，僅供準備';q('dtSession').textContent=`${a.sessionStatus} · ${a.sessionLabel}`;q('dtScore').textContent=`盤中 ${a.score}/100`;q('dtDailyTrend').textContent=daily?.trend||'—';q('dtDailyScore').textContent=Number.isFinite(daily?.score)?`${daily.score}/100`:'—';q('dtDailyConfidence').textContent=Number.isFinite(daily?.confidence)?`${daily.confidence}%`:'—';q('dtDailyPrice').textContent=Number.isFinite(daily?.current)?fmt(daily.current):'—';
    let alertClass='amber',alertTitle='等待盤中確認',alertText='尚未同時滿足 VWAP、EMA9/21 與開盤區間條件。';if(!a.currentSession){alertTitle=a.stale?'目前使用 5 分鐘快取':'目前不在可執行時段';alertText='顯示最近可用的 5 分鐘結構；下一個交易日開盤 15 分鐘後重新掃描，舊進場價不直接沿用。'}else if(a.twLotBlocked){alertClass='red';alertTitle='目前資金不足以形成台股當沖整張部位';alertText='依你的風險與配置上限，模型無法形成至少 1 張普通交易部位，因此本次顯示 0 元、0 股。'}else if(a.active){alertClass='green';alertTitle='多方條件成立';alertText=`價格在 VWAP 上方、EMA9 > EMA21，盤中分數 ${a.score}；只在進場區附近執行，不追高。`}else if(a.weak){alertClass='red';alertTitle='偏空，暫不做多';alertText='價格低於 VWAP 且短均線偏弱；目前版本當沖模式預設只做多。'}q('dtAlert').className=`dt-alert ${alertClass}`;q('dtAlert').innerHTML=`<b>${alertTitle}</b><span>${alertText}</span>`;
    q('dtDirection').textContent=a.direction;q('dtDirectionText').textContent=a.currentSession?(a.active?'只做多方回踩 / 突破':'條件不齊就不交易'):'等待下一個盤中判定窗';const canTrade=a.active,displayShares=canTrade?a.shares:0,displayAmount=canTrade?a.amount:0,cur=data.meta?.currency||(a.tw?'TWD':'USD');q('dtAmount').textContent=money(displayAmount,cur);q('dtShares').textContent=`${displayShares.toLocaleString()} 股${a.tw&&displayShares?` · ${displayShares/1000} 張`:''}`;q('dtEntry').textContent=canTrade?fmt(a.entry):'等待';q('dtEntryText').textContent=canTrade?`${a.entryWindow} · 靠近 VWAP / EMA9`:'開盤 15 分鐘後重新判定';q('dtStop').textContent=canTrade?fmt(a.stop):'—';q('dtRisk').textContent=canTrade?`風險預算 ${money(a.maxLoss,cur)} · 上限 ${a.riskCap}%`:`當沖風險上限 ${a.riskCap}%`;q('dtExitTime').textContent=a.forceExit;q('dtChartTitle').textContent=`${data.symbol} · ${a.sessionLabel}`;q('dtSource').textContent=a.source||'5m';drawDtChart(a);
    q('dtPlanRows').innerHTML=`<div class="dt-plan-row"><span>1</span><div><b>進場</b><small>${a.currentSession?`回測 VWAP ${fmt(a.lastVwap)} / EMA9 ${fmt(a.lastE9)} 不破，或有效突破 OR15 高 ${fmt(a.orHigh)}`:'下一交易日先等 OR15 成形'}</small></div><strong>${canTrade?`${money(a.amount,cur)} · ${a.shares.toLocaleString()} 股`:'0 元 · 0 股'}</strong></div><div class="dt-plan-row"><span>2</span><div><b>停損</b><small>5 分鐘 K 收在 VWAP 下方且跌破結構，或觸及硬停損</small></div><strong class="bad">${canTrade?fmt(a.stop):'—'}</strong></div><div class="dt-plan-row"><span>3</span><div><b>TP1</b><small>約 1.1R，先落袋 50%，剩餘停損移到成本附近</small></div><strong class="good">${canTrade?fmt(a.tp1):'—'}</strong></div><div class="dt-plan-row"><span>4</span><div><b>TP2 / 清倉</b><small>約 1.8R 出剩餘；未達目標也在 ${a.forceExit} 前清倉</small></div><strong class="good">${canTrade?fmt(a.tp2):'—'}</strong></div>`;
    q('dtMetrics').innerHTML=[metric('VWAP',fmt(a.lastVwap),a.current>=a.lastVwap?'good':'bad'),metric('EMA9',fmt(a.lastE9)),metric('EMA21',fmt(a.lastE21)),metric('OR15 高',fmt(a.orHigh),'good'),metric('OR15 低',fmt(a.orLow),'bad'),metric('5m ATR',fmt(a.atr5)),metric('相對量',`${fmt(a.relVol,2)}×`,a.relVol>=1.2?'good':''),metric('盤中分數',`${a.score}/100`,a.score>=68?'good':a.score<=38?'bad':'')].join('');q('dtOpenRule').textContent=a.tw?'09:00 開盤後先等 15 分鐘；09:15 後再用 OR15 + VWAP + EMA9/21 判斷。':'09:30 ET 開盤後先等 15 分鐘；09:45 ET 後再判斷。';q('dtExitRule').textContent=`不留隔夜；TP1 後降低剩餘風險，若 5 分鐘結構轉弱或到 ${a.forceExit} 就退出。`;q('dtEligibility').textContent=a.tw?'需符合券商與市場的當沖資格、標的須可當沖；本站不判斷你的實際帳戶資格。':'美股當沖限制依券商、帳戶類型與所在地規則而異；本站不判斷帳戶資格。';
  }
  function renderError(data,e){q('dtSymbol').textContent=data?.symbol||'—';q('dtSession').textContent='暫無 5m';q('dtScore').textContent='重試可用';q('dtBody').hidden=true;q('dtLoading').hidden=false;q('dtLoading').innerHTML=`<div class="dt-error-compact"><div><b>5 分鐘行情暫時無法取得</b><span>${String(e?.message||e)}。日線資料仍正常，稍後可重新更新。</span></div><button id="dtInlineRetry" class="ghost small" type="button">重新嘗試</button></div>`;q('dtInlineRetry')?.addEventListener('click',()=>{if(renderArgs)renderDaytrade(...renderArgs,{force:true})},{once:true})}
  async function renderDaytrade(data,daily,news,twse,yf,tpex,capital,riskPct,maxAlloc,opts={}){
    if(getMode()!=='daytrade')return;ensurePanel();const my=++requestSeq;q('daytradePanel').hidden=false;q('dtBody').hidden=true;q('dtLoading').hidden=false;q('dtSymbol').textContent=data.symbol;q('dtSession').textContent='同步中';q('dtScore').textContent='5m';q('dtLoading').innerHTML=`<div class="dt-loading-main"><i class="dt-pulse"></i><div><b id="dtLoadingTitle">讀取 5 分鐘行情</b><span id="dtLoadingText">先用 1 日輕量資料，必要時自動切換備援。</span></div></div><div class="dt-loading-steps"><span class="active">5m 行情</span><span>VWAP / OR15</span><span>風險部位</span></div>`;
    try{const intra=await loadIntraday(data.symbol,{force:!!opts.force});if(my!==requestSeq)return;setLoadState('計算 VWAP 與 OR15','整理最近交易日盤中結構',1);await sleep(25);const a=sessionAnalysis(intra,daily,capital,riskPct,maxAlloc);if(my!==requestSeq)return;setLoadState('完成風險部位','產生進場、停損與清倉計畫',2);renderResult(data,daily,a,capital)}catch(e){if(my!==requestSeq)return;renderError(data,e)}
  }

  ensureModeSwitch();ensurePanel();
  if(typeof render==='function'){
    const baseRender=render;
    render=function(...args){baseRender(...args);renderArgs=args;const mode=getMode();document.body.classList.toggle('daytrade-mode',mode==='daytrade');const swing=q('bestStrategyPanel');if(swing)swing.hidden=mode==='daytrade';const dt=q('daytradePanel');if(dt)dt.hidden=mode!=='daytrade';if(mode==='daytrade')renderDaytrade(...args)};
  }
})();