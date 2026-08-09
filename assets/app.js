const $ = id => document.getElementById(id);
let chart;

const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:NaN;
const std=a=>{const m=avg(a);return Math.sqrt(avg(a.map(x=>(x-m)**2)))};
const last=a=>a[a.length-1];
const sum=a=>a.reduce((s,x)=>s+(Number.isFinite(x)?x:0),0);
const fmt=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('zh-TW',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const fmtInt=n=>Number.isFinite(n)?Math.round(n).toLocaleString('zh-TW'):'—';
const pct=n=>Number.isFinite(n)?`${n>=0?'+':''}${(n*100).toFixed(2)}%`:'—';
const quantile=(arr,q)=>{const a=[...arr].sort((x,y)=>x-y),p=(a.length-1)*q,b=Math.floor(p),r=p-b;return a[b+1]!==undefined?a[b]+r*(a[b+1]-a[b]):a[b]};
const parseNum=v=>{const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:NaN};
const safeText=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

function sma(arr,p){return arr.map((_,i)=>i<p-1?null:avg(arr.slice(i-p+1,i+1)))}
function ema(arr,p){const k=2/(p+1);let e=arr[0];return arr.map((v,i)=>{e=i===0?v:v*k+e*(1-k);return e})}
function rsi(arr,p=14){if(arr.length<=p)return Array(arr.length).fill(null);let gains=0,losses=0;for(let i=1;i<=p;i++){const d=arr[i]-arr[i-1];gains+=Math.max(d,0);losses+=Math.max(-d,0)}let ag=gains/p,al=losses/p,out=Array(p).fill(null);out.push(al===0?100:100-100/(1+ag/al));for(let i=p+1;i<arr.length;i++){const d=arr[i]-arr[i-1];ag=(ag*(p-1)+Math.max(d,0))/p;al=(al*(p-1)+Math.max(-d,0))/p;out.push(al===0?100:100-100/(1+ag/al))}return out}
function atr(high,low,close,p=14){const tr=high.map((h,i)=>i===0?h-low[i]:Math.max(h-low[i],Math.abs(h-close[i-1]),Math.abs(low[i]-close[i-1])));return last(sma(tr,p).filter(Number.isFinite))}
function regressionSlope(values){const y=values.map(Math.log),n=y.length,x=Array.from({length:n},(_,i)=>i),xm=avg(x),ym=avg(y);let num=0,den=0;for(let i=0;i<n;i++){num+=(x[i]-xm)*(y[i]-ym);den+=(x[i]-xm)**2}return num/den}
function normal(){let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
function roundLot(symbol,shares){return Math.max(0,Math.floor(shares));}

async function fetchTextSmart(url){
  const routes=[url,`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`];
  let err;
  for(const u of routes){
    try{const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text()}catch(e){err=e}
  }
  throw err||new Error('資料來源無回應');
}
async function fetchJsonSmart(url){return JSON.parse(await fetchTextSmart(url))}

function tickerCandidates(raw){raw=raw.trim().toUpperCase();if(/^\d{4,6}$/.test(raw))return [`${raw}.TW`,`${raw}.TWO`];return [raw]}
async function loadYahoo(raw){
  let lastErr;
  for(const symbol of tickerCandidates(raw)){
    try{
      const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
      const j=await fetchJsonSmart(url),r=j?.chart?.result?.[0];
      if(!r)throw new Error(j?.chart?.error?.description||'找不到代號');
      const q=r.indicators?.quote?.[0],adj=r.indicators?.adjclose?.[0]?.adjclose||q?.close;
      if(!q||!r.timestamp)throw new Error('行情格式不完整');
      const rows=r.timestamp.map((t,i)=>({date:new Date(t*1000),open:q.open[i],high:q.high[i],low:q.low[i],close:adj?.[i]??q.close[i],volume:q.volume[i]})).filter(x=>[x.close,x.high,x.low].every(Number.isFinite));
      if(rows.length<90)throw new Error('歷史資料不足');
      return {symbol,meta:r.meta,rows};
    }catch(e){lastErr=e}
  }
  throw lastErr||new Error('無法取得股價');
}

async function loadYahooFundamental(symbol){
  try{
    const url=`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
    const j=await fetchJsonSmart(url),q=j?.quoteResponse?.result?.[0];
    if(!q)return null;
    return {pe:parseNum(q.trailingPE),forwardPE:parseNum(q.forwardPE),pb:parseNum(q.priceToBook),yieldPct:Number.isFinite(q.dividendYield)?q.dividendYield*100:NaN,eps:parseNum(q.epsTrailingTwelveMonths),marketCap:parseNum(q.marketCap),name:q.longName||q.shortName||''};
  }catch{return null}
}

async function loadTwse(code){
  if(!/^\d{4,6}$/.test(code))return null;
  try{
    const [v,c]=await Promise.all([
      fetchJsonSmart('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL'),
      fetchJsonSmart('https://openapi.twse.com.tw/v1/opendata/t187ap03_L')
    ]);
    const val=(Array.isArray(v)?v:[]).find(x=>String(x.Code||x['證券代號']||'').trim()===code);
    const company=(Array.isArray(c)?c:[]).find(x=>String(x['公司代號']||x['公司代碼']||x.Code||'').trim()===code);
    return {val,company};
  }catch{return null}
}

async function loadInstitutional(code,symbol){
  if(!/^\d{4,6}$/.test(code)||!symbol.endsWith('.TW'))return null;
  try{
    const url='https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=&selectType=ALL';
    const j=await fetchJsonSmart(url);
    const fields=j?.fields||[],data=j?.data||[];
    const row=data.find(r=>String(r?.[0]??'').trim()===code);
    if(!row)return null;
    const idx=(needle,fallback)=>{const i=fields.findIndex(f=>String(f).includes(needle));return i>=0?i:fallback};
    const foreign=parseNum(row[idx('外陸資買賣超股數',4)]);
    const trust=parseNum(row[idx('投信買賣超股數',10)]);
    let dealer=parseNum(row[idx('自營商買賣超股數',11)]);
    const total=parseNum(row[idx('三大法人買賣超股數',18)]);
    if(!Number.isFinite(dealer)&&Number.isFinite(total))dealer=total-(Number.isFinite(foreign)?foreign:0)-(Number.isFinite(trust)?trust:0);
    return {foreign,trust,dealer,total,date:j?.date||'',title:j?.title||''};
  }catch{return null}
}

const POS=['上調','優於','成長','創高','獲利','利多','擴產','訂單','突破','回升','beat','upgrade','growth','record','profit','surge','rally','bullish','buyback','dividend','raise','outperform'];
const NEG=['下調','衰退','虧損','利空','調查','裁員','訴訟','下滑','跌破','風險','miss','downgrade','loss','probe','lawsuit','decline','warning','bearish','cut','underperform'];
function sentiment(t){t=t.toLowerCase();let s=0;POS.forEach(w=>{if(t.includes(w.toLowerCase()))s++});NEG.forEach(w=>{if(t.includes(w.toLowerCase()))s--});return clamp(s,-2,2)}
async function loadNews(symbol,name=''){
  try{
    const q=encodeURIComponent(`${symbol} ${name||''} 股票 OR stock`),url=`https://news.google.com/rss/search?q=${q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    const xml=await fetchTextSmart(url),doc=new DOMParser().parseFromString(xml,'text/xml');
    return [...doc.querySelectorAll('item')].slice(0,8).map(n=>({title:n.querySelector('title')?.textContent||'',link:n.querySelector('link')?.textContent||'#',date:n.querySelector('pubDate')?.textContent||'',score:sentiment(n.querySelector('title')?.textContent||'')}));
  }catch{return []}
}

function scoreFundamentals(pe,pb,yieldPct){
  const available=[pe,pb,yieldPct].filter(Number.isFinite).length;if(!available)return null;
  let s=50;
  if(Number.isFinite(pe)){if(pe>0&&pe<=18)s+=18;else if(pe<=30)s+=10;else if(pe<=50)s+=0;else s-=12}
  if(Number.isFinite(pb)){if(pb>0&&pb<=2)s+=12;else if(pb<=4)s+=5;else if(pb>8)s-=10}
  if(Number.isFinite(yieldPct)){if(yieldPct>=4)s+=10;else if(yieldPct>=2)s+=5;else if(yieldPct<1)s-=2}
  return clamp(Math.round(s),0,100);
}
function weightedScore(items){const valid=items.filter(x=>Number.isFinite(x.score)&&x.weight>0);const w=sum(valid.map(x=>x.weight));return w?Math.round(sum(valid.map(x=>x.score*x.weight))/w):50}

function analyze(data,news,twse,yf,flow,capital,riskPct,maxAlloc){
  const rows=data.rows,close=rows.map(x=>x.close),high=rows.map(x=>x.high),low=rows.map(x=>x.low),vol=rows.map(x=>x.volume||0),dates=rows.map(x=>x.date);
  const e20=ema(close,20),e60=ema(close,60),r14=rsi(close),a14=atr(high,low,close),m12=ema(close,12),m26=ema(close,26),mac=m12.map((x,i)=>x-m26[i]),sig=ema(mac,9),s20=sma(close,20),sd20=std(close.slice(-20)),bbMid=last(s20),bbU=bbMid+2*sd20,bbL=bbMid-2*sd20;
  const current=last(close),prev=close.at(-2),mom20=current/close.at(-21)-1,mom60=current/close.at(-61)-1,volRatio=(last(vol)||0)/(avg(vol.slice(-20))||1),support=Math.min(...low.slice(-20)),resistance=Math.max(...high.slice(-20));
  const logRet=close.slice(1).map((x,i)=>Math.log(x/close[i])).filter(Number.isFinite),dailyVol=std(logRet.slice(-252)),annualVol=dailyVol*Math.sqrt(252),slope=regressionSlope(close.slice(-60)),annualTrend=Math.exp(slope*252)-1,rv=last(r14);
  const newsAvg=news.length?avg(news.map(x=>x.score))/2:0,newsFactor=news.length?clamp(Math.round(50+newsAvg*28),0,100):null;

  let tech=50;tech+=current>last(e20)?9:-9;tech+=last(e20)>last(e60)?12:-12;tech+=last(mac)>last(sig)?9:-9;tech+=mom20>0?7:-7;tech+=mom60>0?7:-7;tech+=annualTrend>0?8:-8;tech+=rv>=45&&rv<=68?7:rv>78?-8:rv<30?2:0;tech+=(volRatio>1.15&&mom20>0)?5:(volRatio>1.4&&mom20<0?-5:0);tech=clamp(Math.round(tech),0,100);
  const riskFactor=clamp(Math.round(82-annualVol*100),20,90);

  const val=twse?.val||{};
  const pe=Number.isFinite(parseNum(val.PEratio||val['本益比']))?parseNum(val.PEratio||val['本益比']):yf?.pe;
  const yieldPct=Number.isFinite(parseNum(val.DividendYield||val['殖利率(%)']||val['殖利率％']))?parseNum(val.DividendYield||val['殖利率(%)']||val['殖利率％']):yf?.yieldPct;
  const pb=Number.isFinite(parseNum(val.PBratio||val['股價淨值比']))?parseNum(val.PBratio||val['股價淨值比']):yf?.pb;
  const fundamentalFactor=scoreFundamentals(pe,pb,yieldPct);

  let flowFactor=null;
  if(flow&&[flow.foreign,flow.trust,flow.dealer,flow.total].some(Number.isFinite)){
    const base=Math.max(avg(vol.slice(-20)),1);const totalNet=Number.isFinite(flow.total)?flow.total:sum([flow.foreign,flow.trust,flow.dealer]);
    const intensity=clamp(totalNet/base,-.18,.18)/.18;
    const alignment=[flow.foreign,flow.trust,flow.dealer].filter(Number.isFinite).reduce((s,x)=>s+(x>0?1:x<0?-1:0),0);
    flowFactor=clamp(Math.round(50+intensity*32+alignment*5),5,95);
  }

  const score=weightedScore([
    {score:tech,weight:45},{score:riskFactor,weight:15},{score:fundamentalFactor,weight:15},{score:flowFactor,weight:15},{score:newsFactor,weight:10}
  ]);
  const trend=score>=75?'強勢偏多':score>=63?'偏多':score>=50?'中性整理':score>=38?'偏空':'弱勢偏空';

  const stopDist=clamp(Math.max(a14*2,current*.05),current*.04,current*.15),stop=Math.max(0,current-stopDist),riskBudget=capital*(riskPct/100),riskShares=Math.floor(riskBudget/stopDist),allocShares=Math.floor((capital*(maxAlloc/100))/current),shares=roundLot(data.symbol,Math.min(riskShares,allocShares)),amount=shares*current,allocationUsed=capital?amount/capital:0;
  const entryA=last(e20),entryB=Math.max(support,bbL),breakout=resistance+a14*.12;

  let signal='amber',signalTitle='等待確認',signalText='條件尚未完整，不追價；等回踩或突破確認。',timingTitle='等待條件成立再進場',timingText=`觀察 EMA20 約 ${fmt(entryA)} 與近20日壓力 ${fmt(resistance)}。收盤守穩 EMA20 或放量突破壓力，才啟動第一筆。`;
  const green=score>=68&&current>=last(e20)*.985&&last(mac)>=last(sig)&&rv<75;
  const red=score<45||current<last(e60)*.97;
  if(green){signal='green';signalTitle='可分批執行';signalText='模型多數條件同向，但仍以收盤確認與停損紀律為前提。';timingTitle='下一交易日可進入分批觀察區';timingText=`若開盤沒有大幅跳空，且價格守住 EMA20 ${fmt(entryA)} 附近，可先執行第一段；若直接急漲超過 EMA20 約 4%，不追價。`}
  if(red){signal='red';signalTitle='暫緩買入';signalText='趨勢或風險訊號偏弱，優先保留現金。';timingTitle='先等結構修復';timingText=`至少等待價格重新站回 EMA20 ${fmt(entryA)}、MACD 改善，或形成新的高低點結構，再重新分析。`}

  const mu=clamp(avg(logRet.slice(-126)),-.0018,.0018),horizons=[5,20,60];
  const forecasts=horizons.map(h=>{const sims=Array.from({length:3000},()=>current*Math.exp((mu-.5*dailyVol**2)*h+dailyVol*Math.sqrt(h)*normal()));const up=sims.filter(x=>x>current).length/sims.length;return {h,p10:quantile(sims,.1),p50:quantile(sims,.5),p90:quantile(sims,.9),up,read:up>=.6?'偏正向':up<=.4?'偏保守':'雙向震盪'}});

  return {rows,dates,close,e20,e60,current,prev,rv,macd:last(mac),signalMacd:last(sig),a14,mom20,mom60,volRatio,annualVol,annualTrend,bbU,bbL,support,resistance,pe,pb,yieldPct,flow,newsAvg,tech,riskFactor,fundamentalFactor,flowFactor,newsFactor,score,trend,shares,amount,allocationUsed,stop,stopDist,riskBudget,entryA,entryB,breakout,signal,signalTitle,signalText,timingTitle,timingText,forecasts};
}

function mini(label,value,cls=''){return `<div class="mini"><span>${label}</span><b class="${cls}">${value}</b></div>`}
function factor(label,value){const v=Number.isFinite(value)?value:50;return `<div class="factor"><span>${label}</span><div class="track"><i style="width:${v}%"></i></div><b>${Number.isFinite(value)?value:'N/A'}</b></div>`}
function flowValue(n){if(!Number.isFinite(n))return '—';const sign=n>0?'+':'';return `${sign}${Math.round(n/1000).toLocaleString('zh-TW')} 張`;}

function drawChart(a,symbol){
  if(chart)chart.destroy();const n=180,labels=a.dates.slice(-n).map(d=>`${d.getMonth()+1}/${d.getDate()}`),price=a.close.slice(-n),e20=a.e20.slice(-n),e60=a.e60.slice(-n),support=labels.map(()=>a.support),resistance=labels.map(()=>a.resistance);
  chart=new Chart($('chart'),{type:'line',data:{labels,datasets:[{label:symbol,data:price,borderWidth:2,pointRadius:0,tension:.12},{label:'EMA20',data:e20,borderWidth:1.2,pointRadius:0,tension:.12},{label:'EMA60',data:e60,borderWidth:1.2,pointRadius:0,tension:.12},{label:'20D 支撐',data:support,borderWidth:1,pointRadius:0,borderDash:[5,5]},{label:'20D 壓力',data:resistance,borderWidth:1,pointRadius:0,borderDash:[5,5]}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#9dafc9',boxWidth:12,font:{size:10}}}},scales:{x:{ticks:{color:'#617391',maxTicksLimit:9},grid:{color:'rgba(70,90,120,.07)'}},y:{ticks:{color:'#617391'},grid:{color:'rgba(70,90,120,.11)'}}}}});
}

function render(data,a,news,twse,yf,capital,riskPct,maxAlloc){
  $('dashboard').hidden=false;const curr=data.meta?.currency||'';
  $('signalOrb').className=`signal-orb ${a.signal}`;$('signalTitle').textContent=a.signalTitle;$('signalText').textContent=a.signalText;
  $('scoreValue').textContent=`${a.score}/100`;$('scoreLabel').textContent=a.trend;
  $('price').textContent=`${fmt(a.current)} ${curr}`;$('change').innerHTML=`日變動 <span class="${a.current>=a.prev?'good':'bad'}">${pct(a.current/a.prev-1)}</span>`;
  $('positionValue').textContent=fmt(a.amount,0);$('positionShares').textContent=`約 ${fmtInt(a.shares)} 股`;
  $('stopValue').textContent=fmt(a.stop);$('riskBudget').textContent=`風險預算 ${fmt(a.riskBudget,0)}`;
  $('chartTitle').textContent=`${data.symbol} · ${data.meta?.shortName||data.meta?.longName||''}`;drawChart(a,data.symbol);
  $('scoreRing').style.setProperty('--score',`${a.score}%`);$('ringNum').textContent=a.score;
  $('factorBars').innerHTML=[factor('技術',a.tech),factor('風險',a.riskFactor),factor('估值',a.fundamentalFactor),factor('法人',a.flowFactor),factor('新聞',a.newsFactor)].join('');

  $('timingBadge').textContent=a.signal==='green'?'綠燈':a.signal==='red'?'紅燈':'黃燈';$('timingTitle').textContent=a.timingTitle;$('timingText').textContent=a.timingText;
  const s1=Math.floor(a.shares*.4),s2=Math.floor(a.shares*.3),s3=Math.max(0,a.shares-s1-s2);
  $('buySteps').innerHTML=`<div class="step"><strong>① 回踩確認 · 40%</strong><b>${fmt(a.entryA)}</b><span>EMA20 附近守穩再進，約 ${fmtInt(s1)} 股。跌破結構就取消。</span></div><div class="step"><strong>② 支撐承接 · 30%</strong><b>${fmt(a.entryB)}</b><span>布林/20日支撐區，約 ${fmtInt(s2)} 股。放量破底不攤平。</span></div><div class="step"><strong>③ 突破確認 · 30%</strong><b>${fmt(a.breakout)}</b><span>突破20日壓力且量能改善，約 ${fmtInt(s3)} 股。</span></div>`;
  $('positionMetrics').innerHTML=[mini('總資金',fmt(capital,0)),mini('單筆風險',`${riskPct}%`),mini('單股上限',`${maxAlloc}%`),mini('ATR 14',fmt(a.a14,2)),mini('停損距離',pct(a.stopDist/a.current),'warn'),mini('可買股數',fmtInt(a.shares))].join('');
  $('allocAmount').textContent=`${fmt(a.amount,0)} / ${fmt(capital,0)}`;$('allocBar').style.width=`${clamp(a.allocationUsed*100,0,100)}%`;

  $('technicalMetrics').innerHTML=[mini('RSI 14',fmt(a.rv,1),a.rv>72?'warn':a.rv<35?'bad':''),mini('MACD',fmt(a.macd,2),a.macd>=a.signalMacd?'good':'bad'),mini('20日動能',pct(a.mom20),a.mom20>=0?'good':'bad'),mini('60日動能',pct(a.mom60),a.mom60>=0?'good':'bad'),mini('量比',fmt(a.volRatio,2),a.volRatio>1.2?'blue':''),mini('年化波動',pct(a.annualVol),'warn'),mini('60日趨勢',pct(a.annualTrend),a.annualTrend>=0?'good':'bad'),mini('20D 支撐',fmt(a.support)),mini('20D 壓力',fmt(a.resistance))].join('');

  const comp=twse?.company||{},companyName=comp['公司簡稱']||comp['公司名稱']||yf?.name||data.meta?.shortName||'';
  $('fundamentalMetrics').innerHTML=[mini('公司',safeText(companyName)||'—'),mini('PE',fmt(a.pe,2)),mini('PB',fmt(a.pb,2)),mini('殖利率',Number.isFinite(a.yieldPct)?`${fmt(a.yieldPct,2)}%`:'—')].join('');
  $('flowMetrics').innerHTML=a.flow?[mini('外資',flowValue(a.flow.foreign),a.flow.foreign>0?'good':a.flow.foreign<0?'bad':''),mini('投信',flowValue(a.flow.trust),a.flow.trust>0?'good':a.flow.trust<0?'bad':''),mini('自營商',flowValue(a.flow.dealer),a.flow.dealer>0?'good':a.flow.dealer<0?'bad':''),mini('三大法人',flowValue(a.flow.total),a.flow.total>0?'good':a.flow.total<0?'bad':'')].join(''):mini('法人資料','目前無資料');
  $('fundamentalNote').textContent=/\.TW$/.test(data.symbol)?'上市台股會優先讀取臺灣證券交易所公開估值與三大法人資料；法人數據為盤後資料。若來源暫時無回應，該因子會自動退出總分，不以 0 分處理。':/\.TWO$/.test(data.symbol)?'上櫃股票目前以行情、技術與新聞為主；TWSE 法人與上市估值資料不套用。':'美股會嘗試公開報價欄位取得估值；若來源限制跨網域，模型會自動改以技術、風險與新聞計分。';

  $('forecastRows').innerHTML=a.forecasts.map(f=>`<tr><td>${f.h} 交易日</td><td class="bad">${fmt(f.p10)}</td><td>${fmt(f.p50)}</td><td class="good">${fmt(f.p90)}</td><td>${(f.up*100).toFixed(1)}%</td><td>${f.read}</td></tr>`).join('');
  $('newsScore').textContent=news.length?`情緒 ${a.newsAvg>0?'+':''}${a.newsAvg.toFixed(2)}`:'新聞暫無資料';
  $('newsList').innerHTML=news.length?news.map(n=>`<a href="${safeText(n.link)}" target="_blank" rel="noopener"><span class="sent ${n.score>0?'good':n.score<0?'bad':''}">${n.score>0?'偏正面':n.score<0?'偏負面':'中性'}</span><b>${safeText(n.title)}</b><small>${safeText(n.date?new Date(n.date).toLocaleString('zh-TW'):'')}</small></a>`).join(''):'<div class="note">新聞 RSS 暫時無法讀取時，新聞因子會退出總分，避免缺失資料被誤判為負面。</div>';
  $('methodText').innerHTML=`<strong>總分：</strong>依可取得資料動態加權。技術 45%、風險 15%、估值 15%、法人 15%、新聞 10%；缺失因子會退出並重新正規化。<br><strong>技術：</strong>EMA20/60、RSI14、MACD(12,26,9)、20/60日動能、量比、60日對數趨勢。<br><strong>法人：</strong>上市台股讀取 TWSE 三大法人盤後買賣超，並依相對於20日均量的強度評分。<br><strong>部位：</strong>「資金 × 單筆風險 ÷ 停損距離」與「單股配置上限」取較小者。<br><strong>情境：</strong>近期日對數報酬估計漂移/波動，執行 3,000 次 GBM，呈現 P10/P50/P90 與高於現價比例；不是目標價。`;
}

async function run(){
  const raw=$('symbol').value.trim(),capital=Math.max(0,+$('capital').value||0),riskPct=clamp(+$('risk').value||1,.1,10),maxAlloc=clamp(+$('allocation').value||25,1,100);if(!raw)return;
  $('go').disabled=true;$('status').className='status';$('status').textContent='正在取得近兩年行情…';
  try{
    const data=await loadYahoo(raw);const code=(data.symbol.match(/^(\d{4,6})\./)||[])[1];
    $('status').textContent=`${data.symbol} 行情完成，正在掃描估值、法人與新聞…`;
    const [twse,yf,flow,news]=await Promise.all([loadTwse(code||''),loadYahooFundamental(data.symbol),loadInstitutional(code||'',data.symbol),loadNews(data.symbol,data.meta?.shortName||'')]);
    const a=analyze(data,news,twse,yf,flow,capital,riskPct,maxAlloc);render(data,a,news,twse,yf,capital,riskPct,maxAlloc);
    $('status').textContent=`分析完成 · ${data.symbol} · ${a.rows.length} 個交易日 · 最後行情 ${a.dates.at(-1).toLocaleDateString('zh-TW')} · 決策燈號：${a.signal==='green'?'綠':a.signal==='red'?'紅':'黃'}`;
    history.replaceState(null,'',`?symbol=${encodeURIComponent(raw)}`);
  }catch(e){console.error(e);$('status').className='status error';$('status').textContent=`分析失敗：${e.message||e}。可能是股票代號錯誤、公開資料源限流或跨網域服務暫時無回應。`}
  finally{$('go').disabled=false}
}
$('form').addEventListener('submit',e=>{e.preventDefault();run()});
const initial=new URLSearchParams(location.search).get('symbol');if(initial){$('symbol').value=initial;run();}
