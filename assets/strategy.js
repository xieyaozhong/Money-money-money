(()=>{
  const q=id=>document.getElementById(id);
  const nfmt=(n,d=2)=>Number.isFinite(n)?Number(n).toLocaleString('zh-TW',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
  const ifmt=n=>Number.isFinite(n)?Math.round(n).toLocaleString('zh-TW'):'—';
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const money=(n,currency)=>`${currency==='TWD'?'NT$':currency==='USD'?'US$':''}${nfmt(n,0)}`;
  const isTw=s=>/\.(TW|TWO)$/.test(String(s||''));

  function ensurePanel(){
    if(q('bestStrategyPanel'))return q('bestStrategyPanel');
    const anchor=q('riskNotice')||q('dashboard')?.firstElementChild;
    if(!anchor)return null;
    const el=document.createElement('article');
    el.id='bestStrategyPanel';
    el.className='panel strategy-panel';
    el.innerHTML=`
      <div class="strategy-head">
        <div><span class="overline">BEST EXECUTION PLAN</span><h3>最佳策略推薦</h3></div>
        <div class="strategy-badges"><span id="strategySignal" class="strategy-badge">—</span><span id="strategyMarket" class="strategy-badge">—</span><span id="strategyConfidence" class="strategy-badge">—</span></div>
      </div>
      <div id="strategyContent"><div class="strategy-note">掃描完成後，這裡會自動產生買入時間、金額、股數與賣出計畫。</div></div>`;
    anchor.insertAdjacentElement('afterend',el);
    return el;
  }

  function marketRule(symbol,totalShares){
    if(isTw(symbol)){
      const odd=totalShares>0&&totalShares<1000;
      return {
        label:/\.TWO$/.test(symbol)?'台股上櫃':'台股上市',
        buyWindow:odd?'下一交易日 09:10–10:30（台灣時間・零股）':'下一交易日 09:05–10:30（台灣時間）',
        sellWindow:odd?'09:10–13:20（台灣時間・零股）':'09:05–13:20（台灣時間）',
        official:'一般交易 09:00–13:30；盤中零股撮合 09:10–13:30',
        href:'https://www.twse.com.tw/zh/products/system/trading.html',
        source:'TWSE'
      };
    }
    return {
      label:'美股',
      buyWindow:'下一交易日 09:45–11:30 ET',
      sellWindow:'09:45–15:45 ET',
      official:'NYSE 核心交易時段 09:30–16:00 ET',
      href:'https://www.nyse.com/trade/trading-information',
      source:'NYSE'
    };
  }

  function shrinkToBudget(steps,budget){
    let amount=()=>steps.reduce((s,x)=>s+x.shares*x.price,0);
    let guard=100000;
    while(amount()>budget&&guard-->0){
      const candidates=steps.filter(x=>x.shares>0).sort((a,b)=>b.price-a.price);
      if(!candidates.length)break;
      candidates[0].shares--;
    }
    steps.forEach(x=>x.amount=x.shares*x.price);
    return steps;
  }

  function makePlan(data,a,capital,riskPct,maxAlloc){
    const currency=data.meta?.currency||(/\.TW$|\.TWO$/.test(data.symbol)?'TWD':'USD');
    const reasons=[];
    if(a.signal==='red'||a.score<45)reasons.push('決策燈號偏弱');
    if(data.stale||a.ageDays>5)reasons.push('行情資料過舊');
    if(a.confidence<55)reasons.push('模型信心不足');
    if(!Number.isFinite(a.shares)||a.shares<1)reasons.push('目前資金與風險限制下無可執行股數');
    if(!capital||capital<=0)reasons.push('可投資資金為 0');

    if(reasons.length){
      return {noTrade:true,currency,reasons,market:marketRule(data.symbol,0)};
    }

    let use=a.signal==='green'?1:.62;
    if(a.confidence<75)use*=.75;
    if(a.annualVol>.55)use*=.70;
    if(a.coverage<65)use*=.75;
    use=Math.max(.30,Math.min(1,use));

    const maxShares=Math.max(1,Math.floor(a.shares*use));
    const budget=Math.max(0,Math.min(a.amount*use,capital*(maxAlloc/100)*use));
    const weights=a.signal==='green'?[.50,.30,.20]:[.25,.35,.40];
    const p1=Math.max(.01,Math.min(Math.max(a.entryA,a.entryLow),a.entryHigh));
    const p2=Math.max(.01,a.entryB);
    const p3=Math.max(.01,a.breakout);
    let s1=Math.floor(maxShares*weights[0]),s2=Math.floor(maxShares*weights[1]);
    let s3=Math.max(0,maxShares-s1-s2);
    if(maxShares===1){s1=a.signal==='green'?1:0;s2=0;s3=a.signal==='green'?0:1;}
    const steps=shrinkToBudget([
      {name:'第一筆',kind:'回踩確認',price:p1,shares:s1,condition:`價格進入 ${nfmt(a.entryLow)}–${nfmt(a.entryHigh)} 且守住 EMA20`,when:'首個符合條件的交易日'},
      {name:'第二筆',kind:'支撐承接',price:p2,shares:s2,condition:'1–5 個交易日內回測支撐但未放量破底',when:'第 1–5 個交易日'},
      {name:'第三筆',kind:'突破加碼',price:p3,shares:s3,condition:`收盤有效站上 ${nfmt(a.breakout)}，且量能改善`,when:'突破確認後下一交易日'}
    ],budget);
    const totalShares=steps.reduce((s,x)=>s+x.shares,0);
    const totalAmount=steps.reduce((s,x)=>s+x.amount,0);
    if(totalShares<1)return {noTrade:true,currency,reasons:['可執行預算不足以完成最低 1 股'],market:marketRule(data.symbol,0)};
    const avgEntry=totalAmount/totalShares;
    const hardStop=Math.max(.01,Math.min(a.stop,avgEntry*.965));
    const riskPerShare=Math.max(avgEntry-hardStop,avgEntry*.035);
    const tp1=avgEntry+riskPerShare*1.2;
    const tp2=avgEntry+riskPerShare*2.0;
    const maxLoss=totalShares*riskPerShare;
    const sell1=totalShares>=3?Math.max(1,Math.floor(totalShares*.4)):0;
    const sell2=totalShares>=3?Math.max(1,Math.floor(totalShares*.4)):totalShares;
    const trail=Math.max(0,totalShares-sell1-sell2);
    const reviewDays=a.signal==='green'&&a.score>=72?20:10;
    const maxDays=a.signal==='green'&&a.score>=72?60:20;
    const market=marketRule(data.symbol,totalShares);
    const f20=(a.forecasts||[]).find(x=>x.h===20),f60=(a.forecasts||[]).find(x=>x.h===60);
    const strategyName=a.signal==='green'?(a.current<=a.entryHigh?'回踩分批 + 1R/2R 出場':'突破確認 + 回踩補倉'):'確認後小部位 + 嚴格時間停損';
    return {noTrade:false,currency,use,budget,maxShares,steps,totalShares,totalAmount,avgEntry,hardStop,riskPerShare,tp1,tp2,maxLoss,sell1,sell2,trail,reviewDays,maxDays,market,f20,f60,strategyName,riskPct,maxAlloc};
  }

  function renderNoTrade(data,a,plan){
    q('strategySignal').className='strategy-badge red';q('strategySignal').textContent='暫不進場';
    q('strategyMarket').textContent=plan.market.label;q('strategyConfidence').textContent=`信心 ${a.confidence}%`;
    q('strategyContent').innerHTML=`
      <div class="strategy-summary">
        <div class="strategy-hero"><span>模型最佳動作</span><b>等待，不建立新倉</b><small>${esc(plan.reasons.join('、'))}。沒有符合條件時，「0 元、0 股」也是策略結果。</small></div>
        <div class="strategy-stat"><span>本次買入金額</span><b>${money(0,plan.currency)}</b></div>
        <div class="strategy-stat"><span>本次買入股數</span><b>0 股</b></div>
        <div class="strategy-stat"><span>重新評估</span><b>下一交易日</b></div>
        <div class="strategy-stat"><span>啟動條件</span><b>分數 ≥ 55</b></div>
      </div>
      <div class="strategy-no-trade"><strong>先不要買</strong><p>至少等待價格重新站穩 EMA20、MACD 結構改善，且模型信心回到 65% 左右，再重新掃描。若你已持有部位，這張卡不等同持倉處置建議；請以原始成本、可承受虧損與即時行情重新計算。</p></div>
      <div class="strategy-foot">交易時段參考：${esc(plan.market.official)}。<a href="${plan.market.href}" target="_blank" rel="noopener noreferrer">${plan.market.source} 官方說明</a>。模型使用的較窄執行窗是降低開收盤雜訊的策略規則，不是交易所規定。</div>`;
  }

  function renderPlan(data,a,plan){
    const sig=a.signal==='green'?'green':'amber';
    q('strategySignal').className=`strategy-badge ${sig}`;q('strategySignal').textContent=a.signal==='green'?'優先策略':'保守策略';
    q('strategyMarket').textContent=plan.market.label;q('strategyConfidence').textContent=`信心 ${a.confidence}%`;
    const stepRows=plan.steps.map((s,i)=>`<div class="strategy-row">
      <div class="tag">${i+1}. ${esc(s.kind)}</div>
      <div class="main"><b>${esc(s.when)}</b><small>${esc(s.condition)}<br>執行窗：${esc(plan.market.buyWindow)}</small></div>
      <div class="money"><b>${money(s.amount,plan.currency)}</b><small>@ ${nfmt(s.price)}</small></div>
      <div class="qty"><b>${ifmt(s.shares)} 股</b><small>${s.shares?`${((s.shares/plan.totalShares)*100).toFixed(0)}% 部位`:'條件未到不買'}</small></div>
    </div>`).join('');
    const prob20=plan.f20?`${(plan.f20.up*100).toFixed(1)}%`:'—',prob60=plan.f60?`${(plan.f60.up*100).toFixed(1)}%`:'—';
    q('strategyContent').innerHTML=`
      <div class="strategy-summary">
        <div class="strategy-hero"><span>推薦策略</span><b>${esc(plan.strategyName)}</b><small>不是一次全押：只有價格與訊號符合時才執行下一筆；任何一筆未符合條件就跳過。</small><div class="strategy-scorebar"><i style="width:${Math.round(plan.use*100)}%"></i></div></div>
        <div class="strategy-stat"><span>預計投入</span><b>${money(plan.totalAmount,plan.currency)}</b></div>
        <div class="strategy-stat"><span>預計股數</span><b>${ifmt(plan.totalShares)} 股</b></div>
        <div class="strategy-stat"><span>估計平均成本</span><b>${money(plan.avgEntry,plan.currency)}</b></div>
        <div class="strategy-stat"><span>最大模型虧損</span><b class="bad">${money(plan.maxLoss,plan.currency)}</b></div>
      </div>

      <div class="strategy-columns">
        <section class="strategy-block">
          <div class="strategy-block-head"><h4>買入計畫</h4><span>${esc(plan.market.buyWindow)}</span></div>
          <div class="strategy-rows">${stepRows}</div>
        </section>
        <section class="strategy-block">
          <div class="strategy-block-head"><h4>賣出計畫</h4><span>${esc(plan.market.sellWindow)}</span></div>
          <div class="strategy-exit-grid">
            <div class="exit-card"><span>價格停損</span><b class="bad">${money(plan.hardStop,plan.currency)}</b><small>觸發即風控，不等待預測實現。</small></div>
            <div class="exit-card"><span>第一停利</span><b class="good">${money(plan.tp1,plan.currency)}</b><small>${plan.sell1?`賣 ${ifmt(plan.sell1)} 股（約 40%）`:'小部位可略過此段'}</small></div>
            <div class="exit-card"><span>第二停利</span><b class="good">${money(plan.tp2,plan.currency)}</b><small>賣 ${ifmt(plan.sell2)} 股${plan.totalShares<3?'（全部）':'（約 40%）'}</small></div>
            <div class="exit-card"><span>趨勢尾倉</span><b>${ifmt(plan.trail)} 股</b><small>${plan.trail?'TP1 後停損上移到成本；收盤跌破 EMA20 則次日退出。':'本次部位過小，不保留尾倉。'}</small></div>
          </div>
          <div class="strategy-rules">
            <div class="strategy-rule"><b>時間檢查</b><span>第 ${plan.reviewDays} 個交易日重新掃描。分數跌破 55、MACD 轉弱或價格低於平均成本時，縮減/退出剩餘部位。</span></div>
            <div class="strategy-rule"><b>最長持有</b><span>${plan.maxDays} 個交易日。若仍未達第一停利且趨勢沒有加速，執行時間停損，不無限等待。</span></div>
            <div class="strategy-rule"><b>情境機率</b><span>20 日高於現價 ${prob20}；60 日高於現價 ${prob60}。這是模擬比例，不是成功率或保證。</span></div>
          </div>
        </section>
      </div>
      <div class="strategy-note"><strong>執行順序：</strong>先確認行情仍在策略區間 → 只下當筆金額 → 設定停損 → 達 TP1 分批落袋 → TP1 後將剩餘部位風險降到成本附近 → 到時間檢查日重新掃描。</div>
      <div class="strategy-foot">交易時段參考：${esc(plan.market.official)}。<a href="${plan.market.href}" target="_blank" rel="noopener noreferrer">${plan.market.source} 官方說明</a>。本站的 ${esc(plan.market.buyWindow)} / ${esc(plan.market.sellWindow)} 是模型偏好執行窗，用來避開部分開收盤雜訊，並非交易所保證的「最佳時間」。策略價格與金額會隨每次掃描重新計算。</div>`;
  }

  function renderStrategy(data,a,news,twse,yf,tpex,capital,riskPct,maxAlloc){
    ensurePanel();
    const plan=makePlan(data,a,capital,riskPct,maxAlloc);
    if(plan.noTrade)renderNoTrade(data,a,plan);else renderPlan(data,a,plan);
  }

  ensurePanel();
  if(typeof render==='function'){
    const baseRender=render;
    render=function(...args){
      baseRender(...args);
      try{renderStrategy(...args)}catch(err){console.error('strategy render failed',err);const c=q('strategyContent');if(c)c.innerHTML='<div class="strategy-note">策略卡計算失敗，但其他分析仍可使用。請重新掃描。</div>'}
    };
  }
})();