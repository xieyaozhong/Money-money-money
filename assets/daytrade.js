(()=>{
  const q=id=>document.getElementById(id);
  const MODE_KEY='money3-mode-v1';
  const INTRA_CACHE=new Map();
  const INTRA_TTL=90*1000;
  let dtChart=null;
  let renderArgs=null;
  let requestSeq=0;

  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:NaN;
  const fmt=(n,d=2)=>Number.isFinite(n)?Number(n).toLocaleString('zh-TW',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
  const money=(n,c)=>`${c==='TWD'?'NT$':c==='USD'?'US$':''}${fmt(n,0)}`;
  const isTw=s=>/\.(TW|TWO)$/.test(String(s||''));
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  function getMode(){return localStorage.getItem(MODE_KEY)||'swing'}
  function setMode(mode){localStorage.setItem(MODE_KEY,mode);document.body.classList.toggle('daytrade-mode',mode==='daytrade');document.querySelectorAll('.trade-mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));const hint=q('tradeModeHint');if(hint)hint.textContent=mode==='daytrade'?'5 分鐘線 · VWAP · OR15 · 當日強制清倉':'日線 · 多因子 · 分批進出';const p=q('daytradePanel');if(p)p.hidden=mode!=='daytrade';const s=q('bestStrategyPanel');if(s)s.hidden=mode==='daytrade';if(mode==='daytrade'&&renderArgs)renderDaytrade(...renderArgs);}

  function ensureModeSwitch(){
    if(q('tradeModeSwitch'))return;
    const command=document.querySelector('.command-card');if(!command)return;
    const row=document.createElement('div');row.id='tradeModeSwitch';row.className='trade-mode-row';row.innerHTML=`<div class="trade-mode-copy"><span>分析模式</span><b id="tradeModeHint">—</b></div><div class="trade-mode-buttons"><button type="button" class="trade-mode-btn" data-mode="swing">波段</button><button type="button" class="trade-mode-btn" data-mode="daytrade">當沖</button></div>`;
    const quick=command.querySelector('.quick-row');quick?command.insertBefore(row,quick):command.appendChild(row);
    row.addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;setMode(b.dataset.mode)});
    setMode(getMode());
  }

  function ensurePanel(){
    if(q('daytradePanel'))return q('daytradePanel');
    const anchor=q('riskNotice')||q('dashboard')?.firstElementChild;if(!anchor)return null;
    const el=document.createElement('article');el.id='daytradePanel';el.className='panel daytrade-panel';el.hidden=true;
    el.innerHTML=`
      <div class="daytrade-head">
        <div><span class="overline">INTRADAY ENGINE · 5M</span><h3>當沖模式</h3></div>
        <div class="daytrade-badges"><span id="dtSession" class="pill">—</span><span id="dtScore" class="pill">—</span><button id="dtRefresh" class="ghost small" type="button">更新 5 分線</button></div>
      </div>
      <div id="dtLoading" class="daytrade-loading">切換到當沖模式後，會額外讀取 5 分鐘線並產生盤中策略。</div>
      <div id="dtBody" hidden>
        <div id="dtAlert" class="dt-alert"></div>
        <div class="dt-decision-grid">
          <div class="dt-hero"><span>盤中方向</span><b id="dtDirection">—</b><small id="dtDirectionText">—</small></div>
          <div class="dt-stat"><span>建議投入</span><b id="dtAmount">—</b><small id="dtShares">—</small></div>
          <div class="dt-stat"><span>進場觸發</span><b id="dtEntry">—</b><small id="dtEntryText">—</small></div>
          <div class="dt-stat"><span>硬停損</span><b id="dtStop">—</b><small id="dtRisk">—</small></div>
          <div class="dt-stat"><span>最晚清倉</span><b id="dtExitTime">—</b><small>不留隔夜部位</small></div>
        </div>
        <div class="dt-main-grid">
          <section class="dt-chart-card">
            <div class="dt-card-head"><div><span>5 分鐘走勢</span><b id="dtChartTitle">—</b></div><span id="dtSource">Yahoo intraday</span></div>
            <div class="dt-chartbox"><canvas id="dtChart"></canvas><div id="dtChartFallback" class="chart-fallback" hidden>圖表元件無法載入，但盤中指標仍可使用。</div></div>
          </section>
          <section class="dt-plan-card">
            <div class="dt-card-head"><div><span>執行計畫</span><b>只做符合條件的一筆</b></div></div>
            <div id="dtPlanRows" class="dt-plan-rows"></div>
          </section>
        </div>
        <div class="dt-metrics" id="dtMetrics"></div>
        <div class="dt-rules">
          <div><b>開盤規則</b><span id="dtOpenRule">—</span></div>
          <div><b>退出規則</b><span id="dtExitRule">—</span></div>
          <div><b>台股資格提醒</b><span id="dtEligibility">—</span></div>
        </div>
        <div class="dt-foot">當沖模式使用 5 分鐘行情與短線技術條件，不等同即時成交報價；下單前請以券商即時行情、可當沖標的與帳戶資格為準。台股零股不適用現股當日沖銷。</div>
      </div>`;
    anchor.insertAdjacentElement('afterend',el);
    q('dtRefresh')?.addEventListener('click',()=>{if(renderArgs)renderDaytrade(...renderArgs,{force:true})});
    return el;
  }

  async function fetchText(url,timeout=8000){
    const routes=[url,`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`];let err;
    for(const u of routes){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeout);try{const r=await fetch(u,{cache:'no-store',signal:ctl.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);const t=await r.text();if(!t)throw new Error('空白回應');return t}catch(e){err=e}finally{clearTimeout(timer)}}throw err||new Error('5 分鐘行情無回應');
  }

  async function loadIntraday(symbol,{force=false}={}){
    const key=String(symbol).toUpperCase(),cached=INTRA_CACHE.get(key);if(!force&&cached&&Date.now()-cached.ts<INTRA_TTL)return cached.data;
    let lastErr;
    for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
      try{
        const url=`https://${host}/v8/finance/chart/${encodeURIComponent(key)}?range=5d&interval=5m&includePrePost=false&events=div%2Csplits`;
        const j=JSON.parse(await fetchText(url)),r=j?.chart?.result?.[0];if(!r)throw new Error(j?.chart?.error?.description||'無 5 分鐘資料');
        const qte=r.indicators?.quote?.[0];if(!qte||!r.timestamp)throw new Error('5 分鐘資料格式不完整');
        const tz=isTw(key)?'Asia/Taipei':'America/New_York';
        const rows=r.timestamp.map((t,i)=>({t:new Date(t*1000),open:qte.open[i],high:qte.high[i],low:qte.low[i],close:qte.close[i],volume:qte.volume[i]||0})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));
        if(rows.length<12)throw new Error('5 分鐘資料不足');
        const data={symbol:key,meta:r.meta||{},tz,rows,source:'Yahoo Finance 5m'};INTRA_CACHE.set(key,{ts:Date.now(),data});return data;
      }catch(e){lastErr=e}
    }
    throw lastErr||new Error('無法取得 5 分鐘行情');
  }

  function localParts(date,tz){
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
    return {date:`${p.year}-${p.month}-${p.day}`,min:(+p.hour)*60+(+p.minute),label:`${p.hour}:${p.minute}`};
  }

  function ema(values,p){const k=2/(p+1);let e=values[0];return values.map((v,i)=>e=i?e+(v-e)*k:v)}
  function atr(rows,p=14){const tr=rows.map((r,i)=>i?Math.max(r.high-r.low,Math.abs(r.high-rows[i-1].close),Math.abs(r.low-rows[i-1].close)):r.high-r.low);if(tr.length<p)return avg(tr);return avg(tr.slice(-p))}
  function sessionAnalysis(data,daily,capital,riskPct,maxAlloc){
    const tw=isTw(data.symbol),openMin=tw?540:570,closeMin=tw?810:960;
    const tagged=data.rows.map(r=>({...r,...localParts(r.t,data.tz)})).filter(r=>r.min>=openMin&&r.min<=closeMin);
    const latest=[...new Set(tagged.map(r=>r.date))].sort().at(-1);const rows=tagged.filter(r=>r.date===latest);if(rows.length<6)throw new Error('最近交易日 5 分鐘資料不足');
    const closes=rows.map(x=>x.close),e9=ema(closes,9),e21=ema(closes,21);let pv=0,vv=0;const vwap=rows.map(r=>{const tp=(r.high+r.low+r.close)/3;pv+=tp*r.volume;vv+=r.volume;return vv?pv/vv:r.close});
    const orRows=rows.filter(r=>r.min<openMin+15).slice(0,3),orHigh=Math.max(...orRows.map(x=>x.high)),orLow=Math.min(...orRows.map(x=>x.low));
    const current=rows.at(-1).close,lastVwap=vwap.at(-1),lastE9=e9.at(-1),lastE21=e21.at(-1),atr5=Math.max(atr(rows),current*.0015),volBase=avg(rows.slice(-21,-1).map(x=>x.volume).filter(Number.isFinite))||1,relVol=rows.at(-1).volume/volBase;
    let score=50;score+=current>lastVwap?13:-13;score+=lastE9>lastE21?12:-12;score+=current>orHigh?10:current<orLow?-10:0;score+=relVol>=1.25?(current>lastVwap?7:-7):0;score+=daily?.tech>=65?6:daily?.tech<=35?-6:0;score=clamp(Math.round(score),0,100);
    const historical=latest!==localParts(new Date(),data.tz).date;
    const longOk=score>=68&&current>lastVwap&&lastE9>lastE21;
    const weak=score<=38&&current<lastVwap&&lastE9<lastE21;
    const direction=historical?'準備模式':longOk?'多方當沖':weak?'偏空觀望':'等待突破';
    const riskCap=Math.min(Math.max(+riskPct||.5,.1),.75),riskBudget=capital*(riskCap/100),stopDist=clamp(Math.max(atr5*1.2,current*.003),current*.0025,current*.012),sharesRisk=Math.floor(riskBudget/stopDist),sharesAlloc=Math.floor((capital*(maxAlloc/100))/current);let shares=Math.max(0,Math.min(sharesRisk,sharesAlloc));
    let twLotBlocked=false;if(tw){shares=Math.floor(shares/1000)*1000;if(shares<1000)twLotBlocked=true}
    const active=longOk&&!historical&&!twLotBlocked;
    const entry=Math.max(lastVwap,lastE9),stop=Math.max(.01,entry-stopDist),tp1=entry+stopDist*1.1,tp2=entry+stopDist*1.8,amount=shares*entry,maxLoss=shares*stopDist;
    const sessionLabel=latest,forceExit=tw?'13:20 前':'15:50 ET 前',entryWindow=tw?'09:15–11:30':'09:45–12:00 ET';
    return {rows,e9,e21,vwap,current,lastVwap,lastE9,lastE21,orHigh,orLow,atr5,relVol,score,historical,longOk,weak,direction,riskCap,riskBudget,stopDist,shares,twLotBlocked,active,entry,stop,tp1,tp2,amount,maxLoss,sessionLabel,forceExit,entryWindow,tw};
  }

  function drawDtChart(a){
    if(dtChart){dtChart.destroy();dtChart=null}const canvas=q('dtChart');if(typeof Chart==='undefined'){canvas.hidden=true;q('dtChartFallback').hidden=false;return}canvas.hidden=false;q('dtChartFallback').hidden=true;
    const labels=a.rows.map(r=>r.label),orH=labels.map(()=>a.orHigh),orL=labels.map(()=>a.orLow);
    dtChart=new Chart(canvas,{type:'line',data:{labels,datasets:[{label:'價格',data:a.rows.map(r=>r.close),borderColor:'#edf5ff',borderWidth:2,pointRadius:0,tension:.08},{label:'VWAP',data:a.vwap,borderColor:'#54d6e8',borderWidth:1.4,pointRadius:0},{label:'EMA9',data:a.e9,borderColor:'#69a7ff',borderWidth:1.2,pointRadius:0},{label:'EMA21',data:a.e21,borderColor:'#a78bfa',borderWidth:1.2,pointRadius:0},{label:'OR15 High',data:orH,borderColor:'#4be5a4',borderWidth:1,pointRadius:0,borderDash:[5,5]},{label:'OR15 Low',data:orL,borderColor:'#ff6f7e',borderWidth:1,pointRadius:0,borderDash:[5,5]}]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:180},plugins:{legend:{labels:{color:'#9dafc9',boxWidth:10,font:{size:9}}}},scales:{x:{ticks:{color:'#617391',maxTicksLimit:8},grid:{display:false}},y:{ticks:{color:'#617391'},grid:{color:'rgba(70,90,120,.08)'}}}}});
  }

  function metric(label,value,cls=''){return `<div class="dt-metric"><span>${label}</span><b class="${cls}">${value}</b></div>`}
  function renderResult(data,daily,a,capital){
    q('dtLoading').hidden=true;q('dtBody').hidden=false;q('dtSession').textContent=a.historical?`最近交易日 ${a.sessionLabel}`:`本日 ${a.sessionLabel}`;q('dtScore').textContent=`盤中分數 ${a.score}/100`;
    let alertClass='amber',alertTitle='等待盤中確認',alertText='尚未同時滿足 VWAP、EMA9/21 與開盤區間條件。';
    if(a.historical){alertTitle='市場目前非盤中';alertText='顯示最近交易日 5 分鐘結構；下一交易日開盤 15 分鐘後請重新掃描，不能直接沿用舊進場價。'}
    else if(a.twLotBlocked){alertClass='red';alertTitle='資金不足以執行台股現股當沖';alertText='台股零股不適用現股當日沖銷；依目前風險與配置上限，模型無法形成至少 1 張（1,000 股）的普通交易部位。'}
    else if(a.active){alertClass='green';alertTitle='多方條件成立';alertText=`價格在 VWAP 上方、EMA9 > EMA21，且盤中分數達 ${a.score}。只在進場區附近執行，不追高。`}
    else if(a.weak){alertClass='red';alertTitle='偏空，暫不做多';alertText='價格低於 VWAP 且短均線偏弱；此版本當沖模式預設只做多，不主動建立空單。'}
    q('dtAlert').className=`dt-alert ${alertClass}`;q('dtAlert').innerHTML=`<b>${alertTitle}</b><span>${alertText}</span>`;
    q('dtDirection').textContent=a.direction;q('dtDirectionText').textContent=a.historical?'等待下一交易日 OR15 成形後再判斷':a.active?'只做多方回踩/突破':'條件不齊就不交易';
    const canTrade=a.active;const displayShares=canTrade?a.shares:0,displayAmount=canTrade?a.amount:0;
    q('dtAmount').textContent=money(displayAmount,data.meta?.currency|| (a.tw?'TWD':'USD'));q('dtShares').textContent=`${displayShares.toLocaleString()} 股${a.tw&&displayShares?` · ${displayShares/1000} 張`:''}`;
    q('dtEntry').textContent=canTrade?fmt(a.entry):'等待';q('dtEntryText').textContent=canTrade?`${a.entryWindow} · 靠近 VWAP/EMA9`:'開盤 15 分鐘後重新判定';
    q('dtStop').textContent=canTrade?fmt(a.stop):'—';q('dtRisk').textContent=canTrade?`風險預算 ${money(a.maxLoss,data.meta?.currency|| (a.tw?'TWD':'USD'))} · 上限 ${a.riskCap}%`:`當沖風險上限 ${a.riskCap}%`;
    q('dtExitTime').textContent=a.forceExit;q('dtChartTitle').textContent=`${data.symbol} · ${a.sessionLabel}`;q('dtSource').textContent='Yahoo Finance · 5m';drawDtChart(a);
    const cur=data.meta?.currency||(a.tw?'TWD':'USD');
    q('dtPlanRows').innerHTML=`
      <div class="dt-plan-row"><span>1</span><div><b>進場</b><small>${a.historical?'下一交易日先等 OR15 成形':`價格回測 VWAP ${fmt(a.lastVwap)} / EMA9 ${fmt(a.lastE9)} 不破，或有效突破 OR15 高點 ${fmt(a.orHigh)}`}</small></div><strong>${canTrade?`${money(a.amount,cur)} · ${a.shares.toLocaleString()} 股`:'0 元 · 0 股'}</strong></div>
      <div class="dt-plan-row"><span>2</span><div><b>停損</b><small>5 分鐘 K 收在 VWAP 下方且跌破結構，或價格觸及硬停損</small></div><strong class="bad">${canTrade?fmt(a.stop):'—'}</strong></div>
      <div class="dt-plan-row"><span>3</span><div><b>TP1</b><small>到達約 1.1R，先落袋 50%，停損抬到成本附近</small></div><strong class="good">${canTrade?fmt(a.tp1):'—'}</strong></div>
      <div class="dt-plan-row"><span>4</span><div><b>TP2 / 清倉</b><small>到達約 1.8R 出剩餘；未達目標也在 ${a.forceExit} 前清倉</small></div><strong class="good">${canTrade?fmt(a.tp2):'—'}</strong></div>`;
    q('dtMetrics').innerHTML=[metric('VWAP',fmt(a.lastVwap),a.current>=a.lastVwap?'good':'bad'),metric('EMA9',fmt(a.lastE9)),metric('EMA21',fmt(a.lastE21)),metric('OR15 高',fmt(a.orHigh),'good'),metric('OR15 低',fmt(a.orLow),'bad'),metric('5m ATR',fmt(a.atr5)),metric('相對量',`${fmt(a.relVol,2)}×`,a.relVol>=1.2?'good':''),metric('盤中分數',`${a.score}/100`,a.score>=68?'good':a.score<=38?'bad':'')].join('');
    q('dtOpenRule').textContent=a.tw?'09:00 開盤後先等 15 分鐘；09:15 後才用 OR15 + VWAP + EMA9/21 判斷。':'09:30 ET 開盤後先等 15 分鐘；09:45 ET 後才判斷，避免直接追開盤第一段波動。';
    q('dtExitRule').textContent=`不留隔夜。TP1 後將剩餘風險降到成本附近；若 5 分鐘結構轉弱或到 ${a.forceExit}，退出剩餘部位。`;
    q('dtEligibility').textContent=a.tw?'現股當沖須先符合券商/交易所資格，且標的須為可當沖證券；零股不適用。股票當沖賣出證交稅優惠稅率現行為 0.15% 至 2027/12/31，券商手續費另計。':'美股當沖限制依券商、帳戶類型與所在地規則而異；本站不判斷你的帳戶是否具備當沖資格。';
  }

  async function renderDaytrade(data,daily,news,twse,yf,tpex,capital,riskPct,maxAlloc,opts={}){
    if(getMode()!=='daytrade')return;ensurePanel();const my=++requestSeq;q('daytradePanel').hidden=false;q('dtLoading').hidden=false;q('dtLoading').textContent='正在讀取 5 分鐘行情、VWAP 與開盤區間…';q('dtBody').hidden=true;
    try{const intra=await loadIntraday(data.symbol,{force:!!opts.force});if(my!==requestSeq)return;const a=sessionAnalysis(intra,daily,capital,riskPct,maxAlloc);renderResult(data,daily,a,capital)}catch(e){if(my!==requestSeq)return;q('dtLoading').hidden=false;q('dtLoading').innerHTML=`5 分鐘行情暫時無法使用：${String(e.message||e)}。<br>日線分析仍可正常使用，稍後可按「更新 5 分線」重試。`;q('dtBody').hidden=true}
  }

  ensureModeSwitch();ensurePanel();
  if(typeof render==='function'){
    const baseRender=render;
    render=function(...args){baseRender(...args);renderArgs=args;const mode=getMode();document.body.classList.toggle('daytrade-mode',mode==='daytrade');const swing=q('bestStrategyPanel');if(swing)swing.hidden=mode==='daytrade';const dt=q('daytradePanel');if(dt)dt.hidden=mode!=='daytrade';if(mode==='daytrade')renderDaytrade(...args)};
  }
})();
