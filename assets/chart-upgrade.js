(()=>{
  const MAIN_RANGE_KEY='money3-main-chart-range-v2';
  const DT_RANGE_KEY='money3-dt-chart-range-v2';
  let mainRange=localStorage.getItem(MAIN_RANGE_KEY)||'6m';
  let dtRange=localStorage.getItem(DT_RANGE_KEY)||'120';
  let mainContext=null;
  let dtTimer=null;

  const $u=id=>document.getElementById(id);
  const finite=n=>Number.isFinite(Number(n));
  const nfmt=(n,d=0)=>finite(n)?Number(n).toLocaleString('zh-TW',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
  const parseDisplay=v=>{const s=String(v??'').replace(/[^0-9.\-]/g,'');const n=Number(s);return Number.isFinite(n)?n:NaN};

  const moneyGuidePlugin={
    id:'moneyGuideLines',
    beforeDatasetsDraw(chart,args,opts){
      const y=chart.scales?.y,area=chart.chartArea;if(!y||!area)return;
      const bands=Array.isArray(opts?.bands)?opts.bands:[];
      const ctx=chart.ctx;ctx.save();
      for(const b of bands){
        if(!finite(b.low)||!finite(b.high))continue;
        const py1=y.getPixelForValue(Number(b.high)),py2=y.getPixelForValue(Number(b.low));
        const top=Math.min(py1,py2),h=Math.abs(py2-py1);
        ctx.fillStyle=b.color||'rgba(105,167,255,.08)';
        ctx.fillRect(area.left,top,area.right-area.left,h);
      }
      ctx.restore();
    },
    afterDatasetsDraw(chart,args,opts){
      const y=chart.scales?.y,area=chart.chartArea;if(!y||!area)return;
      const guides=Array.isArray(opts?.guides)?opts.guides:[];
      const ctx=chart.ctx;ctx.save();
      for(const g of guides){
        if(!finite(g.value))continue;
        const value=Number(g.value),py=y.getPixelForValue(value);
        if(py<area.top-2||py>area.bottom+2)continue;
        ctx.beginPath();ctx.setLineDash(g.dash||[5,5]);ctx.lineWidth=g.width||1;ctx.strokeStyle=g.color||'#8294b3';ctx.moveTo(area.left,py);ctx.lineTo(area.right,py);ctx.stroke();ctx.setLineDash([]);
        if(g.label){
          const text=`${g.label} ${nfmt(value,g.decimals??0)}`;
          ctx.font='700 10px system-ui,-apple-system,sans-serif';
          const tw=ctx.measureText(text).width,pad=5,w=tw+pad*2,h=18,x=Math.max(area.left+2,area.right-w-3),yy=Math.max(area.top+2,Math.min(py-h/2,area.bottom-h-2));
          ctx.fillStyle=g.bg||'rgba(7,13,23,.88)';ctx.beginPath();
          if(ctx.roundRect)ctx.roundRect(x,yy,w,h,6);else ctx.rect(x,yy,w,h);
          ctx.fill();ctx.fillStyle=g.color||'#edf5ff';ctx.textBaseline='middle';ctx.fillText(text,x+pad,yy+h/2+.5);
        }
      }
      ctx.restore();
    }
  };

  if(typeof Chart!=='undefined'){
    try{Chart.register(moneyGuidePlugin)}catch{}
  }

  function rangeCount(range,total){
    if(range==='1m')return Math.min(total,22);
    if(range==='3m')return Math.min(total,66);
    if(range==='6m')return Math.min(total,132);
    if(range==='1y')return Math.min(total,264);
    return total;
  }

  function ensureMainTools(){
    const panel=document.querySelector('.chart-panel');if(!panel||panel.querySelector('.chart-upgrade-tools'))return;
    const box=panel.querySelector('.chartbox');if(!box)return;
    const tools=document.createElement('div');tools.className='chart-upgrade-tools';
    tools.innerHTML=`<div class="chart-range-group" aria-label="圖表時間範圍">
      <button class="chart-range-btn" type="button" data-main-range="1m">1M</button>
      <button class="chart-range-btn" type="button" data-main-range="3m">3M</button>
      <button class="chart-range-btn" type="button" data-main-range="6m">6M</button>
      <button class="chart-range-btn" type="button" data-main-range="1y">1Y</button>
      <button class="chart-range-btn" type="button" data-main-range="all">全部</button>
    </div><span class="chart-range-note">拖曳提示可看日期與指標</span>`;
    box.parentNode.insertBefore(tools,box);syncMainButtons();
  }
  function syncMainButtons(){document.querySelectorAll('[data-main-range]').forEach(b=>b.classList.toggle('active',b.dataset.mainRange===mainRange))}

  function mainGuides(a){
    const out=[
      {value:a.current,label:'現價',color:'#edf5ff',dash:[2,4],width:1.2,decimals:2,bg:'rgba(19,31,49,.94)'},
      {value:a.support,label:'支撐',color:'#4be5a4',dash:[6,6],decimals:2},
      {value:a.resistance,label:'壓力',color:'#ff6f7e',dash:[6,6],decimals:2}
    ];
    if(finite(a.stop))out.push({value:a.stop,label:'停損',color:'#ff8b96',dash:[3,5],decimals:2});
    return out;
  }

  function enhancedDrawChart(a,symbol){
    mainContext={a,symbol};ensureMainTools();syncMainButtons();
    if(typeof Chart==='undefined'){
      const canvas=$u('chart'),fallback=$u('chartFallback');if(canvas)canvas.hidden=true;if(fallback){fallback.hidden=false;fallback.textContent='圖表元件目前無法載入，但分析數值仍可使用。'}return;
    }
    if(typeof chart!=='undefined'&&chart){try{chart.destroy()}catch{} chart=null}
    const canvas=$u('chart'),fallback=$u('chartFallback');if(!canvas)return;canvas.hidden=false;if(fallback)fallback.hidden=true;
    const total=a.close.length,count=rangeCount(mainRange,total),dates=a.dates.slice(-count),labels=dates.map(d=>`${d.getMonth()+1}/${d.getDate()}`),price=a.close.slice(-count),e20=a.e20.slice(-count),e60=a.e60.slice(-count);
    const visible=[...price,...e20.filter(finite),...e60.filter(finite),a.support,a.resistance,a.stop].filter(finite).map(Number),lo=Math.min(...visible),hi=Math.max(...visible),pad=Math.max((hi-lo)*.08,hi*.015,1);
    const guideOptions={guides:mainGuides(a),bands:finite(a.entryLow)&&finite(a.entryHigh)?[{low:a.entryLow,high:a.entryHigh,color:'rgba(105,167,255,.075)'}]:[]};
    chart=new Chart(canvas,{type:'line',data:{labels,datasets:[
      {label:symbol,data:price,borderColor:'#edf5ff',borderWidth:2.4,pointRadius:0,pointHoverRadius:4,tension:.16},
      {label:'EMA20',data:e20,borderColor:'#69a7ff',borderWidth:1.6,pointRadius:0,tension:.16},
      {label:'EMA60',data:e60,borderColor:'#a78bfa',borderWidth:1.5,pointRadius:0,tension:.16}
    ]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:220},interaction:{mode:'index',intersect:false},elements:{line:{borderCapStyle:'round',borderJoinStyle:'round'}},plugins:{
      legend:{position:'bottom',labels:{color:'#91a4c2',usePointStyle:true,pointStyle:'line',boxWidth:18,padding:13,font:{size:10}}},
      tooltip:{displayColors:false,backgroundColor:'rgba(6,11,20,.96)',borderColor:'rgba(122,151,193,.26)',borderWidth:1,padding:10,titleColor:'#edf5ff',bodyColor:'#c7d5e9',callbacks:{title(items){return items?.[0]?.label?`日期 ${items[0].label}`:''},label(ctx){return `${ctx.dataset.label}：${nfmt(ctx.parsed.y,2)}`}}},
      moneyGuideLines:guideOptions
    },scales:{x:{ticks:{color:'#657895',maxTicksLimit:window.innerWidth<620?6:9,maxRotation:0},grid:{color:'rgba(70,90,120,.045)'},border:{display:false}},y:{suggestedMin:lo-pad,suggestedMax:hi+pad,ticks:{color:'#657895',maxTicksLimit:7,callback:v=>Number(v).toLocaleString('zh-TW')},grid:{color:'rgba(70,90,120,.09)'},border:{display:false}}}}});
  }

  function installMainOverride(){
    ensureMainTools();
    if(typeof drawChart==='function'&&!drawChart.__moneyV2){
      const fn=function(a,symbol){return enhancedDrawChart(a,symbol)};fn.__moneyV2=true;drawChart=fn;
      if(typeof lastScan!=='undefined'&&lastScan?.a&&lastScan?.data)enhancedDrawChart(lastScan.a,lastScan.data.symbol);
    }
  }

  function ensureDtTools(){
    const head=document.querySelector('.dt-chart-card .dt-card-head');if(!head||head.querySelector('.dt-range-group'))return;
    const g=document.createElement('div');g.className='dt-range-group';g.innerHTML=`<button type="button" class="dt-range-btn" data-dt-range="60">60分</button><button type="button" class="dt-range-btn" data-dt-range="120">120分</button><button type="button" class="dt-range-btn" data-dt-range="all">全日</button>`;head.appendChild(g);syncDtButtons();
  }
  function syncDtButtons(){document.querySelectorAll('[data-dt-range]').forEach(b=>b.classList.toggle('active',b.dataset.dtRange===dtRange))}
  function dtCount(range,total){if(range==='60')return Math.min(total,12);if(range==='120')return Math.min(total,24);return total}

  function enhanceDtChart(){
    if(typeof Chart==='undefined')return;const c=Chart.getChart('dtChart');if(!c)return;ensureDtTools();
    if(!c.$moneyFull){c.$moneyFull={labels:[...c.data.labels],datasets:c.data.datasets.map(ds=>[...(ds.data||[])])};}
    const priceFull=c.$moneyFull.datasets[0]||[],current=priceFull.at(-1),entry=parseDisplay($u('dtEntry')?.textContent),stop=parseDisplay($u('dtStop')?.textContent),rows=document.querySelectorAll('#dtPlanRows .dt-plan-row'),tp1=parseDisplay(rows?.[2]?.querySelector('strong')?.textContent),tp2=parseDisplay(rows?.[3]?.querySelector('strong')?.textContent);
    const guides=[{value:current,label:'現價',color:'#edf5ff',dash:[2,4],decimals:2,bg:'rgba(19,31,49,.94)'}];
    if(finite(entry))guides.push({value:entry,label:'進場',color:'#54d6e8',dash:[4,4],decimals:2});
    if(finite(stop))guides.push({value:stop,label:'停損',color:'#ff6f7e',dash:[4,4],decimals:2});
    if(finite(tp1))guides.push({value:tp1,label:'TP1',color:'#4be5a4',dash:[3,5],decimals:2});
    if(finite(tp2))guides.push({value:tp2,label:'TP2',color:'#79efbd',dash:[3,5],decimals:2});
    c.options.plugins.moneyGuideLines={guides,bands:[]};
    c.options.plugins.legend={position:'bottom',labels:{color:'#91a4c2',usePointStyle:true,pointStyle:'line',boxWidth:15,padding:10,font:{size:9}}};
    c.options.interaction={mode:'index',intersect:false};
    c.options.plugins.tooltip={displayColors:false,backgroundColor:'rgba(6,11,20,.96)',borderColor:'rgba(122,151,193,.26)',borderWidth:1,padding:9,titleColor:'#edf5ff',bodyColor:'#c7d5e9'};
    c.options.scales.x.ticks={...(c.options.scales.x.ticks||{}),color:'#657895',maxTicksLimit:window.innerWidth<620?5:8,maxRotation:0};
    c.options.scales.y.ticks={...(c.options.scales.y.ticks||{}),color:'#657895',maxTicksLimit:7,callback:v=>Number(v).toLocaleString('zh-TW')};
    applyDtRange(c,false);
  }

  function applyDtRange(c,animate=true){
    if(!c?.$moneyFull)return;const total=c.$moneyFull.labels.length,count=dtCount(dtRange,total),start=Math.max(0,total-count);c.data.labels=c.$moneyFull.labels.slice(start);c.data.datasets.forEach((ds,i)=>{ds.data=(c.$moneyFull.datasets[i]||[]).slice(start)});syncDtButtons();c.update(animate?'none':'none');
  }

  document.addEventListener('click',e=>{
    const mb=e.target.closest('[data-main-range]');if(mb){mainRange=mb.dataset.mainRange;localStorage.setItem(MAIN_RANGE_KEY,mainRange);syncMainButtons();if(mainContext)enhancedDrawChart(mainContext.a,mainContext.symbol);return;}
    const db=e.target.closest('[data-dt-range]');if(db){dtRange=db.dataset.dtRange;localStorage.setItem(DT_RANGE_KEY,dtRange);syncDtButtons();if(typeof Chart!=='undefined')applyDtRange(Chart.getChart('dtChart'));}
  });

  const observer=new MutationObserver(()=>{clearTimeout(dtTimer);dtTimer=setTimeout(enhanceDtChart,80)});
  window.addEventListener('DOMContentLoaded',()=>{installMainOverride();ensureMainTools();const root=$u('dashboard')||document.body;observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});setTimeout(enhanceDtChart,250)});
  window.addEventListener('resize',()=>{clearTimeout(dtTimer);dtTimer=setTimeout(()=>{if(mainContext)enhancedDrawChart(mainContext.a,mainContext.symbol);enhanceDtChart()},180)});
})();
