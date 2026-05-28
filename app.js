const API = 'https://script.google.com/macros/s/AKfycbwNLiBH0mx91Bvr1ixIFfP1A6V4K7hT0Uo5r6yfWu8xNk-tHyezlvRLLeqZKEByXA5n/exec';

const CATEGORIES = [
  'Food & drink','Transport','Records & music','Shopping / clothes',
  'Entertainment','Personal care','Subscriptions','Bills & utilities',
  'Banking & interest','Health','Charity','Gifts','Miscellaneous'
];

// Categories that are FIXED/non-discretionary — excluded from disposable budget
const FIXED_CATS = ['Subscriptions','Bills & utilities','Banking & interest','Health','Charity','Gifts'];
// Categories that count toward disposable spending
const DISPOSABLE_CATS = ['Food & drink','Transport','Records & music','Shopping / clothes','Entertainment','Personal care','Miscellaneous'];
const DISPOSABLE_BUDGET = 500;
const DAILY_BUDGET = Math.round(DISPOSABLE_BUDGET / 28 * 10) / 10; // ~£17.86/day

const CAT_COLORS = {
  'Food & drink':'#ffaa00','Transport':'#4488ff','Records & music':'#aa44ff',
  'Shopping / clothes':'#ff44aa','Entertainment':'#44ffcc','Personal care':'#ff8844',
  'Subscriptions':'#44ffff','Bills & utilities':'#ff4444','Banking & interest':'#ff6666',
  'Health':'#44ff88','Charity':'#88ff44','Gifts':'#ff44ff','Miscellaneous':'#888888'
};

const CAT_EMOJI = {
  'Food & drink':'🍔','Transport':'🚇','Records & music':'🎵',
  'Shopping / clothes':'🛍️','Entertainment':'🎭','Personal care':'💈',
  'Subscriptions':'📱','Bills & utilities':'🏠','Banking & interest':'🏦',
  'Health':'💊','Charity':'🤝','Gifts':'🎁','Miscellaneous':'📦'
};

const DEFAULT_BUDGETS = {
  'Food & drink':180,'Transport':80,'Records & music':80,'Shopping / clothes':60,
  'Entertainment':40,'Personal care':20,'Subscriptions':68,'Bills & utilities':607.50,
  'Banking & interest':0,'Health':0,'Charity':0,'Gifts':0,'Miscellaneous':40
};

const DEFAULT_BALANCES = {
  'Monzo':190.00,'Lloyds current':150.00,'Lloyds credit card':-9024.03
};

const ACCOUNTS = ['Monzo','Lloyds current','Lloyds credit card'];
const SAVINGS_ACCOUNTS = ['Monzo','Lloyds current','Lloyds credit card'];
const CC_START = -9024.03;

/* ── Local cache ── */
const CACHE_KEY = 'budget_cache_v1';

function saveCache(){
  try{
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      transactions: state.transactions,
      payments: state.payments,
      balances: state.balances,
      budgets: state.budgets,
      cachedAt: Date.now()
    }));
  }catch(e){ /* storage full or private mode */ }
}

function loadCache(){
  try{
    const raw = localStorage.getItem(CACHE_KEY);
    if(!raw) return false;
    const cached = JSON.parse(raw);
    const age = Date.now() - (cached.cachedAt||0);
    // Use cache if less than 24 hours old
    if(age > 86400000) return false;
    state.transactions = (cached.transactions||[]).map(normTx);
    state.payments     = (cached.payments||[]).map(normPay);
    if(cached.balances && Object.keys(cached.balances).length > 0)
      state.balances = cached.balances;
    if(cached.budgets && Object.keys(cached.budgets).length > 0)
      state.budgets = cached.budgets;
    return true;
  }catch(e){ return false; }
}
const APR = 0.2366;

let state = {
  transactions:[],payments:[],
  balances:JSON.parse(JSON.stringify(DEFAULT_BALANCES)),
  budgets:JSON.parse(JSON.stringify(DEFAULT_BUDGETS))
};

let activeAddTab = 'expense';

/* ── Sync ── */
function setSync(s,l){
  document.getElementById('syncDot').className='sync-dot '+s;
  document.getElementById('syncLabel').textContent=l;
}

async function apiCall(params){
  const url=new URL(API);
  Object.entries(params).forEach(([k,v])=>
    url.searchParams.set(k,typeof v==='object'?JSON.stringify(v):String(v))
  );
  const res=await fetch(url.toString(),{method:'GET',redirect:'follow'});
  if(!res.ok) throw new Error('HTTP '+res.status);
  const text=await res.text();
  try{return JSON.parse(text)}catch(e){throw new Error('Bad response')}
}

async function loadAll(){
  // 1. Load from cache instantly so the UI is never blank
  const hasCached = loadCache();
  if(hasCached){
    setSync('syncing','updating...');
    renderAll(); // show cached data immediately
  } else {
    setSync('syncing','loading...');
  }

  // 2. Fetch fresh data in background
  try{
    const data=await apiCall({action:'getAll'});
    if(data.error) throw new Error(data.error);
    state.transactions=(data.transactions||[]).map(normTx);
    state.payments=(data.payments||[]).map(normPay);
    if(data.balances&&Object.keys(data.balances).length>0) state.balances=data.balances;
    else await apiCall({action:'initBalances',data:state.balances});
    if(data.budgets&&Object.keys(data.budgets).length>0){
      state.budgets=data.budgets;
      // Always enforce correct defaults for any category the Sheet has wrong or missing
      let needsUpdate=false;
      Object.entries(DEFAULT_BUDGETS).forEach(([cat,val])=>{
        const sheetVal=parseFloat(state.budgets[cat]);
        if(state.budgets[cat]===undefined||isNaN(sheetVal)||(val>0&&sheetVal===0)){
          state.budgets[cat]=val;
          needsUpdate=true;
        }
      });
      if(needsUpdate){
        await apiCall({action:'initBudgets',data:state.budgets});
      }
    } else {
      await apiCall({action:'initBudgets',data:state.budgets});
    }
    saveCache(); // update cache with fresh data
    setSync('ok','synced');
    renderAll(); // re-render with fresh data
  }catch(e){
    if(hasCached){
      setSync('ok','cached'); // show cached data, note it is offline
    } else {
      setSync('err','offline');
    }
    console.error(e);
    renderAll();
  }
}

function normTx(t){
  return{id:String(t.id||''),date:String(t.date||'').split('T')[0],amount:parseFloat(t.amount)||0,
    description:String(t.description||''),category:String(t.category||''),
    account:String(t.account||''),type:'expense'};
}
function normPay(p){
  return{id:String(p.id||''),date:String(p.date||'').split('T')[0],amount:parseFloat(p.amount)||0,
    from:String(p.from||''),to:String(p.to||''),note:String(p.note||''),
    type:String(p.type||'payment')};
}

/* ── Helpers ── */
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
function fmt(n){return'£'+Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',')}
function today(){return new Date().toISOString().split('T')[0]}
function fmtDate(iso){
  if(!iso) return '';
  // Handle ISO datetime strings from Google Sheets e.g. "2026-04-18T23:00:00.000Z"
  const str = String(iso).split('T')[0];
  if(str.length < 10) return str;
  const[y,m,d]=str.split('-');
  if(!y||!m||!d) return str;
  return d+'/'+m+'/'+y;
}
function currentYM(){return new Date().toISOString().slice(0,7)}
function fmtYM(ym){
  const[y,m]=ym.split('-');
  return new Date(y,m-1,1).toLocaleString('en-GB',{month:'long',year:'numeric'});
}
function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2000);
}

/* ── Navigation ── */
function showPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  document.querySelector('.nav-item[data-page="'+id+'"]').classList.add('active');
  if(id==='transactions'||id==='budget') populateMonthSelects();
  renderAll();
}

/* ── Sheet ── */
function openSheet(){
  document.getElementById('overlay').classList.add('open');
  document.getElementById('sheet').classList.add('open');
  setAddTab('expense');
  // Always reset dates to today when sheet opens
  ['eDate','pDate','iDate'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.value=today();
  });
}
function closeSheet(){
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('sheet').classList.remove('open');
}
function setAddTab(tab){
  activeAddTab=tab;
  document.querySelectorAll('.sheet-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  document.querySelectorAll('.sheet-panel').forEach(p=>p.style.display=p.dataset.panel===tab?'block':'none');
}

/* ── Selects ── */
function populateSelects(){
  const cats=document.getElementById('eCat');
  if(cats) cats.innerHTML=CATEGORIES.map(c=>`<option>${c}</option>`).join('');
  ['eAcc','pFrom','iAcc'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.innerHTML=ACCOUNTS.map(a=>`<option>${a}</option>`).join('');
  });
  const pTo=document.getElementById('pTo');
  if(pTo) pTo.innerHTML=SAVINGS_ACCOUNTS.map(a=>`<option>${a}</option>`).join('');
  ['eDate','pDate','iDate'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&!el.value) el.value=today();
  });
}

function populateMonthSelects(){
  // Generate last 6 pay periods
  const periods=new Set();
  const now=new Date();
  for(let i=0;i<7;i++){
    const d=new Date(now.getFullYear(),now.getMonth()-i,28);
    const y=d.getFullYear();
    const m=d.getMonth()+1;
    // This 28th starts a period labelled as next month
    const nextM=m===12?1:m+1;
    const nextY=m===12?y+1:y;
    periods.add(padYM(nextY,nextM));
  }
  // Also add periods for any existing transactions
  [...state.transactions,...state.payments].forEach(t=>{
    if(!t.date) return;
    const d=t.date.split('T')[0];
    if(d.length<10) return;
    const[ty,tm,td]=d.split('-').map(Number);
    // Which period does this date belong to?
    if(td>=28){
      // Belongs to next month's period
      const nm=tm===12?1:tm+1;
      const ny=tm===12?ty+1:ty;
      periods.add(padYM(ny,nm));
    } else {
      periods.add(padYM(ty,tm));
    }
  });
  const opts=[...periods].sort().reverse();
  ['txMonthFilter','budgetMonthFilter'].forEach(id=>{
    const sel=document.getElementById(id);
    if(!sel) return;
    const cur=sel.value||currentYM();
    sel.innerHTML=opts.map(p=>`<option value="${p}"${p===cur?' selected':''}>${fmtYM(p)}</option>`).join('');
  });
}

/* ── Add expense ── */
async function addExpense(){
  const date=document.getElementById('eDate').value;
  const amt=parseFloat(document.getElementById('eAmt').value);
  const desc=document.getElementById('eDesc').value.trim();
  const cat=document.getElementById('eCat').value;
  const acc=document.getElementById('eAcc').value;
  if(!date||!amt||amt<=0){toast('Enter date + amount');return}
  const tx={id:uid(),date,amount:amt,description:desc||cat,category:cat,account:acc,type:'expense'};
  state.transactions.unshift(tx);
  state.balances[acc]=(state.balances[acc]||0)-amt;
  document.getElementById('eAmt').value='';
  document.getElementById('eDesc').value='';
  closeSheet();renderAll();toast('Expense added');
  setSync('syncing','saving...');
  try{await apiCall({action:'addTransaction',data:tx});saveCache();setSync('ok','synced')}
  catch(e){setSync('err','sync failed')}
}

/* ── Add payment ── */
async function addPayment(){
  const date=document.getElementById('pDate').value;
  const amt=parseFloat(document.getElementById('pAmt').value);
  const from=document.getElementById('pFrom').value;
  const to=document.getElementById('pTo').value;
  const note=document.getElementById('pNote').value.trim();
  if(!date||!amt||amt<=0){toast('Enter date + amount');return}
  const p={id:uid(),date,amount:amt,from,to,note:note||`${from} → ${to}`,type:'payment'};
  state.payments.unshift(p);
  state.balances[from]=(state.balances[from]||0)-amt;
  if(ACCOUNTS.includes(to)) state.balances[to]=(state.balances[to]||0)+amt;
  document.getElementById('pAmt').value='';
  document.getElementById('pNote').value='';
  closeSheet();renderAll();toast('Payment logged');
  setSync('syncing','saving...');
  try{await apiCall({action:'addPayment',data:p});saveCache();setSync('ok','synced')}
  catch(e){setSync('err','sync failed')}
}

/* ── Add income ── */
async function addIncome(){
  const date=document.getElementById('iDate').value;
  const amt=parseFloat(document.getElementById('iAmt').value);
  const acc=document.getElementById('iAcc').value;
  const desc=document.getElementById('iDesc').value.trim();
  if(!date||!amt||amt<=0){toast('Enter date + amount');return}
  const p={id:uid(),date,amount:amt,from:'external',to:acc,note:desc||'Income',type:'income'};
  state.payments.unshift(p);
  state.balances[acc]=(state.balances[acc]||0)+amt;
  document.getElementById('iAmt').value='';
  document.getElementById('iDesc').value='';
  closeSheet();renderAll();toast('Income added');
  setSync('syncing','saving...');
  try{await apiCall({action:'addPayment',data:p});saveCache();setSync('ok','synced')}
  catch(e){setSync('err','sync failed')}
}

/* ── Delete ── */
async function deleteTx(id){
  const tx=state.transactions.find(t=>t.id===id);
  if(!tx||!confirm(`Delete "${tx.description}"?`)) return;
  state.transactions=state.transactions.filter(t=>t.id!==id);
  state.balances[tx.account]=(state.balances[tx.account]||0)+tx.amount;
  renderAll();toast('Deleted');
  setSync('syncing','saving...');
  try{await apiCall({action:'deleteTransaction',data:tx});saveCache();setSync('ok','synced')}
  catch(e){setSync('err','sync failed')}
}

async function deletePayment(id){
  const p=state.payments.find(t=>t.id===id);
  if(!p||!confirm(`Delete "${p.note}"?`)) return;
  state.payments=state.payments.filter(t=>t.id!==id);
  if(p.type==='income') state.balances[p.to]=(state.balances[p.to]||0)-p.amount;
  else{
    state.balances[p.from]=(state.balances[p.from]||0)+p.amount;
    if(ACCOUNTS.includes(p.to)) state.balances[p.to]=(state.balances[p.to]||0)-p.amount;
  }
  renderAll();toast('Deleted');
  setSync('syncing','saving...');
  try{await apiCall({action:'deletePayment',data:p});saveCache();setSync('ok','synced')}
  catch(e){setSync('err','sync failed')}
}

/* ── TX item HTML ── */
function txItemHTML(tx){
  let col,emoji,name,meta,amtStr,amtClass,delFn;
  if(tx._type==='expense'){
    col=CAT_COLORS[tx.category]||'#888';
    emoji=CAT_EMOJI[tx.category]||'📦';
    name=tx.description||tx.category;
    meta=`${tx.category} · ${tx.account} · ${fmtDate(tx.date)}`;
    amtStr='-'+fmt(tx.amount);amtClass='neg';delFn=`deleteTx('${tx.id}')`;
  }else if(tx._type==='income'){
    col='#44ff88';emoji='💸';
    name=tx.note||'Income';meta=`${tx.to} · ${fmtDate(tx.date)}`;
    amtStr='+'+fmt(tx.amount);amtClass='pos';delFn=`deletePayment('${tx.id}')`;
  }else{
    col='#4488ff';emoji='💳';
    name=tx.note||'Payment';meta=`${tx.from} → ${tx.to} · ${fmtDate(tx.date)}`;
    amtStr='-'+fmt(tx.amount);amtClass='transfer';delFn=`deletePayment('${tx.id}')`;
  }
  return`<div class="tx-item">
    <div class="tx-dot" style="border-color:${col}33;font-size:16px">${emoji}</div>
    <div class="tx-body">
      <div class="tx-name">${name}</div>
      <div class="tx-meta">${meta}</div>
    </div>
    <div class="tx-right">
      <div class="tx-amount ${amtClass}">${amtStr}</div>
    </div>
    <button class="tx-del" onclick="${delFn}">×</button>
  </div>`;
}

function allSorted(ym){
  const txs=ym?state.transactions.filter(t=>inPeriod(t.date,ym)):state.transactions;
  const pays=ym?state.payments.filter(t=>inPeriod(t.date,ym)):state.payments;
  return[
    ...txs.map(t=>({...t,_type:'expense'})),
    ...pays.map(t=>({...t,_type:t.type}))
  ].sort((a,b)=>b.date.localeCompare(a.date));
}

/* ── Render: balances ── */
function renderBalances(){
  const b=state.balances;
  const monzo=b['Monzo']||0,lloyds=b['Lloyds current']||0;
  const cc=b['Lloyds credit card']||0,liquid=monzo+lloyds;
  document.getElementById('balanceCards').innerHTML=`
    <div class="stat">
      <div class="stat-label">Monzo</div>
      <div class="stat-value ${monzo>=0?'green':'red'}">${fmt(monzo)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Lloyds current</div>
      <div class="stat-value ${lloyds>=200?'green':lloyds>=0?'amber':'red'}">${fmt(lloyds)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Credit card</div>
      <div class="stat-value red">${fmt(Math.abs(cc))}</div>
      <div class="stat-sub">${cc<0?'owed':'clear'}</div>
    </div>
    <div class="stat highlight">
      <div class="stat-label">Liquid total</div>
      <div class="stat-value ${liquid>=500?'green':liquid>=100?'amber':'red'}">${fmt(liquid)}</div>
      <div class="stat-sub">Monzo + Lloyds</div>
    </div>`;
}

/* ── Render: glance ── */
function renderGlance(){
  const ym=currentYM();
  const now=new Date();
  const dayOfMonth=now.getDate();
  const txs=state.transactions.filter(t=>inPeriod(t.date,ym));

  // Disposable spend only
  const dispSpent=DISPOSABLE_CATS.reduce((s,c)=>{
    return s+txs.filter(t=>t.category===c).reduce((a,t)=>a+t.amount,0);
  },0);
  const dispRem=DISPOSABLE_BUDGET-dispSpent;

  // Days until 28th (payday)
  // Days until next 28th (payday)
  const daysToPayday=dayOfMonth<28?28-dayOfMonth:0;
  const idealSpend=DAILY_BUDGET*daysToPayday;
  const surplus=dispRem-idealSpend;

  const pct=Math.min(100,Math.round((dispSpent/DISPOSABLE_BUDGET)*100));
  const barCol=pct>90?'#ff4444':pct>70?'#ffaa00':'#44ff88';

  const bar=document.getElementById('overviewBar');
  const barLabel=document.getElementById('overviewBarLabel');
  if(bar){bar.style.width=pct+'%';bar.style.background=barCol}
  if(barLabel) barLabel.textContent='Disposable: '+pct+'% of £500 budget used — '+fmtYM(ym);

  const el=document.getElementById('glance');
  if(el) el.innerHTML=
    '<div class="row"><span class="row-label">Disposable budget</span><span class="row-val">'+fmt(DISPOSABLE_BUDGET)+'</span></div>'
    +'<div class="row"><span class="row-label">Spent so far</span><span class="row-val red">'+fmt(dispSpent)+'</span></div>'
    +'<div class="row"><span class="row-label">Remaining</span><span class="row-val '+(dispRem>=0?'green':'red')+'">'+fmt(dispRem)+'</span></div>'
    +'<div class="row"><span class="row-label">Days to payday</span><span class="row-val">'+daysToPayday+' days</span></div>'
    +'<div class="row"><span class="row-label">Daily budget</span><span class="row-val">£'+DAILY_BUDGET.toFixed(2)+'</span></div>';

  // Surplus card
  const surplusEl=document.getElementById('surplusCard');
  if(surplusEl){
    if(surplus>20){
      surplusEl.innerHTML=
        '<div class="section-header"><span class="section-title">💳 Extra for credit card</span></div>'
        +'<div class="row"><span class="row-label">Surplus vs daily pace</span><span class="row-val green">'+fmt(surplus)+'</span></div>'
        +'<div class="row"><span class="row-label">Interest saving if paid now</span><span class="row-val amber">~'+fmt(surplus*(0.2366/12))+'</span></div>'
        +'<div style="padding:10px 14px;font-size:12px;color:#888">You are ahead of your £18/day pace. Consider moving '+fmt(surplus)+' to the credit card today.</div>';
      surplusEl.style.display='';
    } else if(surplus<-20){
      surplusEl.innerHTML=
        '<div class="section-header"><span class="section-title">⚠️ Spending ahead of pace</span></div>'
        +'<div class="row"><span class="row-label">Over daily pace by</span><span class="row-val red">'+fmt(Math.abs(surplus))+'</span></div>'
        +'<div style="padding:10px 14px;font-size:12px;color:#888">Try to keep daily spend under '+fmt(dispRem/Math.max(daysToPayday,1))+' for the rest of the month.</div>';
      surplusEl.style.display='';
    } else {
      surplusEl.style.display='none';
    }
  }
}

function renderDebtMini(){
  const cc=state.balances['Lloyds credit card']||0;
  const owed=Math.abs(cc),start=Math.abs(CC_START);
  const paid=Math.max(0,start-owed),pct=Math.min(100,Math.round((paid/start)*100));
  const el=document.getElementById('debtMini');
  if(el) el.innerHTML=`
    <div class="row"><span class="row-label">Owed</span><span class="row-val red">${fmt(owed)}</span></div>
    <div class="row"><span class="row-label">Paid off</span><span class="row-val green">${fmt(paid)}</span></div>
    <div style="padding:0 14px 14px">
      <div class="debt-track"><div class="debt-fill" style="width:${pct}%"></div></div>
      <div style="font-size:10px;color:#444;font-family:'Space Mono',monospace;letter-spacing:0.05em">${pct}% CLEARED</div>
    </div>`;
}

/* ── Render: recent ── */
function renderRecent(){
  const all=allSorted(null).slice(0,10);
  const el=document.getElementById('recentList');
  if(el) el.innerHTML=all.length?all.map(txItemHTML).join(''):'<div class="empty-msg">No transactions yet</div>';
}

/* ── Render: transactions ── */
function renderTransactions(){
  const ym=document.getElementById('txMonthFilter')?.value||currentYM();
  const all=allSorted(ym);
  const el=document.getElementById('txList');
  if(!el) return;
  el.innerHTML=all.length?all.map(txItemHTML).join(''):'<div class="empty-msg">Nothing this month</div>';
}

/* ── Render: budget ── */
function renderBudget(){
  const ym=document.getElementById('budgetMonthFilter')?.value||currentYM();
  const txs=state.transactions.filter(t=>inPeriod(t.date,ym));
  const spend={};CATEGORIES.forEach(c=>spend[c]=0);
  txs.forEach(t=>{if(spend[t.category]!==undefined)spend[t.category]+=t.amount});
  const el=document.getElementById('budgetList');
  if(!el) return;

  function budgetItem(c){
    const s=spend[c]||0;
    const sheetBudget=parseFloat(state.budgets[c])||0;
    const b=sheetBudget===0&&DEFAULT_BUDGETS[c]>0?DEFAULT_BUDGETS[c]:sheetBudget;
    if(b===0&&s===0) return'';
    const pct=b>0?Math.min(100,Math.round((s/b)*100)):100;
    const rem=b-s;
    const barCol=pct>90?'#ff4444':pct>70?'#ffaa00':'#44ff88';
    const col=CAT_COLORS[c]||'#888';
    const remStr=rem<0?'<span style="color:#ff4444">-'+fmt(Math.abs(rem))+' over</span>'
      :pct>70?'<span style="color:#ffaa00">'+fmt(rem)+' left</span>'
      :'<span style="color:#444">'+fmt(rem)+' left</span>';
    return'<div class="budget-item">'
      +'<div class="budget-top">'
      +'<div class="budget-name"><div class="budget-dot" style="background:'+col+'"></div>'+c+'</div>'
      +'<div class="budget-nums"><strong>'+fmt(s)+'</strong> / '+(b>0?fmt(b):'—')+'<br>'+(b>0?remStr:'')+'</div>'
      +'</div>'
      +'<div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:'+barCol+'"></div></div>'
      +'</div>';
  }

  // Disposable totals
  const dispSpent=DISPOSABLE_CATS.reduce((s,c)=>s+(spend[c]||0),0);
  const dispBudget=DISPOSABLE_BUDGET;
  const dispRem=dispBudget-dispSpent;
  const dispPct=Math.min(100,Math.round((dispSpent/dispBudget)*100));
  const dispBarCol=dispPct>90?'#ff4444':dispPct>70?'#ffaa00':'#44ff88';

  // Fixed totals
  const fixedSpent=FIXED_CATS.reduce((s,c)=>s+(spend[c]||0),0);
  const fixedBudget=FIXED_CATS.reduce((s,c)=>s+(parseFloat(state.budgets[c])||DEFAULT_BUDGETS[c]||0),0);

  // Total
  const totalSpent=dispSpent+fixedSpent;
  const totalBudget=dispBudget+fixedBudget;

  el.innerHTML=
    // ── Disposable section ──
    '<div style="padding:10px 14px 6px;border-bottom:1px solid #333">'
    +'<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">'
    +'<span style="font-size:10px;font-weight:700;letter-spacing:0.1em;color:#888;text-transform:uppercase">Disposable</span>'
    +'<span style="font-family:Space Mono,monospace;font-size:11px;color:#888">'+fmt(dispSpent)+' of '+fmt(dispBudget)+'</span>'
    +'</div>'
    +'<div class="bar-track" style="margin-bottom:4px"><div class="bar-fill" style="width:'+dispPct+'%;background:'+dispBarCol+'"></div></div>'
    +'<div style="font-size:10px;color:#444;font-family:Space Mono,monospace;letter-spacing:0.04em">~£18/DAY BUDGET · '+fmt(dispRem)+' '+(dispRem>=0?'remaining':'over')+'</div>'
    +'</div>'
    +DISPOSABLE_CATS.map(budgetItem).join('')
    // ── Fixed section ──
    +'<div style="padding:10px 14px 6px;border-top:1px solid #333;border-bottom:1px solid #333;margin-top:4px">'
    +'<div style="display:flex;justify-content:space-between;align-items:baseline">'
    +'<span style="font-size:10px;font-weight:700;letter-spacing:0.1em;color:#888;text-transform:uppercase">Fixed / non-discretionary</span>'
    +'<span style="font-family:Space Mono,monospace;font-size:11px;color:#888">'+fmt(fixedSpent)+' of '+fmt(fixedBudget)+'</span>'
    +'</div>'
    +'</div>'
    +FIXED_CATS.map(budgetItem).join('')
    // ── Total row ──
    +'<div class="row" style="padding:12px 14px;border-top:1px solid #333;margin-top:4px">'
    +'<span style="font-size:13px;font-weight:600">Total</span>'
    +'<span class="row-val">'+fmt(totalSpent)+' of '+fmt(totalBudget)+'</span>'
    +'</div>';
}

/* ── Render: debt ── */
function renderDebt(){
  const cc=state.balances['Lloyds credit card']||0;
  const owed=Math.abs(cc),start=Math.abs(CC_START);
  const paid=Math.max(0,start-owed),pct=Math.min(100,Math.round((paid/start)*100));
  const monthly=owed*(APR/12);
  const el=document.getElementById('debtDetail');
  if(el) el.innerHTML=`
    <div class="section-header"><span class="section-title">Lloyds Platinum</span></div>
    <div class="row"><span class="row-label">Current balance</span><span class="row-val red">${fmt(owed)}</span></div>
    <div class="row"><span class="row-label">Started at</span><span class="row-val">${fmt(start)}</span></div>
    <div class="row"><span class="row-label">Paid off</span><span class="row-val green">${fmt(paid)}</span></div>
    <div class="row"><span class="row-label">APR</span><span class="row-val">23.66%</span></div>
    <div class="row"><span class="row-label">Est. interest this month</span><span class="row-val amber">~${fmt(monthly)}</span></div>
    <div style="padding:0 14px 14px">
      <div class="debt-track" style="margin-top:12px"><div class="debt-fill" style="width:${pct}%"></div></div>
      <div style="font-size:10px;color:#444;font-family:'Space Mono',monospace;letter-spacing:0.05em;margin-top:4px">${pct}% CLEARED</div>
    </div>`;

  const mr=APR/12;
  const proj=document.getElementById('debtProjection');
  if(proj) proj.innerHTML=[400,600,800,1000,1200,1500,1800].map(pmt=>{
    if(pmt<=owed*mr) return`<div class="scenario-row"><span class="row-label" style="font-family:'Space Mono',monospace;font-size:12px">£${pmt}/mo</span><span class="row-val red">NEVER</span></div>`;
    let bal=owed,months=0,interest=0;
    while(bal>0&&months<360){const i=bal*mr;interest+=i;bal=bal+i-pmt;months++}
    const y=Math.floor(months/12),m=months%12;
    const timeStr=(y>0?y+'y ':'')+m+'m';
    const col=months<=12?'#44ff88':months<=24?'#ffaa00':'#ff4444';
    return`<div class="scenario-row">
      <span class="row-label" style="font-family:'Space Mono',monospace;font-size:12px">£${pmt}/mo</span>
      <span class="scenario-right">
        <span class="scenario-time" style="color:${col}">${timeStr}</span>
        <span class="scenario-int">${fmt(interest)} interest</span>
      </span>
    </div>`;
  }).join('');
}

/* ── Render: settings ── */
function renderSettings(){
  const bs=document.getElementById('balanceSettings');
  if(bs) bs.innerHTML=ACCOUNTS.map(acc=>`
    <div class="setting-item">
      <span class="setting-label">${acc}</span>
      <input class="setting-input" type="number" step="0.01"
        value="${(parseFloat(state.balances[acc])||0).toFixed(2)}"
        onchange="updateBalance('${acc}',this.value)">
    </div>`).join('');
  const bgs=document.getElementById('budgetSettings');
  if(bgs) bgs.innerHTML=CATEGORIES.map(c=>`
    <div class="setting-item">
      <span class="setting-label">${c}</span>
      <input class="setting-input" type="number" step="1" min="0"
        value="${(parseFloat(state.budgets[c])||0).toFixed(0)}"
        onchange="updateBudget('${c}',this.value)">
    </div>`).join('');
}

async function updateBalance(acc,val){
  state.balances[acc]=parseFloat(val)||0;renderBalances();renderGlance();
  setSync('syncing','saving...');
  try{await apiCall({action:'initBalances',data:state.balances});saveCache();setSync('ok','synced');toast('Saved')}
  catch(e){setSync('err','sync failed')}
}

async function updateBudget(cat,val){
  state.budgets[cat]=parseFloat(val)||0;
  setSync('syncing','saving...');
  try{await apiCall({action:'initBudgets',data:state.budgets});saveCache();setSync('ok','synced');toast('Saved')}
  catch(e){setSync('err','sync failed')}
}

async function clearAllData(){
  if(!confirm('Delete all transactions? Balances kept.')) return;
  state.transactions=[];state.payments=[];
  renderAll();toast('Cleared');
}

/* ── Fixed payment schedule ── */
const FIXED_PAYMENTS = [
  {day:1,  label:'Yolanda SO',        amt:570.00,  acc:'Lloyds current',     income:false},
  {day:1,  label:'Denplan DD (parents)',amt:22.50,  acc:'Lloyds current',     income:true},
  {day:2,  label:'Adobe CC',          amt:11.99,   acc:'Lloyds credit card', income:false},
  {day:6,  label:'Sky Mobile DD',     amt:60.00,   acc:'Lloyds current',     income:false},
  {day:10, label:'Framer',            amt:12.00,   acc:'Lloyds credit card', income:false},
  {day:10, label:'Apple',             amt:8.99,    acc:'Lloyds credit card', income:false},
  {day:15, label:'Surfshark',         amt:9.07,    acc:'Lloyds credit card', income:false},
  {day:16, label:'YouTube Premium',   amt:8.99,    acc:'Lloyds credit card', income:false},
  {day:28, label:'Salary (£3,018 net)', amt:3018.01, acc:'Lloyds current',   income:true},
];

const BUDGET_SUGGESTIONS = {
  'Transport':          {suggested:80,  reason:'Your Jan/Feb average was around £60. Dropping to £80 is more realistic and frees up £20/month for the credit card.'},
  'Shopping / clothes': {suggested:40,  reason:'You historically spend around £30/month here. £40 gives headroom without over-allocating.'},
  'Entertainment':      {suggested:20,  reason:'This category rarely gets used independently — £20 is a fair buffer.'},
  'Miscellaneous':      {suggested:40,  reason:'Non-London months average around £30 here. £40 is generous enough.'},
};

/* ── Render: insights ── */
function renderInsights(){
  const el=document.getElementById('insightsList');
  if(!el) return;

  const ym=currentYM();
  const now=new Date();
  const day=now.getDate();
  const daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  const progress=day/daysInMonth;
  const daysLeft=daysInMonth-day;

  const txs=state.transactions.filter(t=>inPeriod(t.date,ym));
  const b=state.balances;
  const liquid=(b['Monzo']||0)+(b['Lloyds current']||0);
  const lloyds=b['Lloyds current']||0;
  const cc=Math.abs(b['Lloyds credit card']||0);
  const interest=cc*(0.2366/12);

  const spend={};
  CATEGORIES.forEach(c=>spend[c]=0);
  txs.forEach(t=>{if(spend[t.category]!==undefined)spend[t.category]+=t.amount});

  const totalSpent=txs.reduce((s,t)=>s+t.amount,0);
  const totalBudget=Object.values(state.budgets).reduce((s,v)=>s+parseFloat(v||0),0);

  const insights=[];

  // 1. Upcoming fixed payments in next 7 days
  const upcoming=FIXED_PAYMENTS.filter(p=>{
    const d=p.day>=day?p.day-day:(daysInMonth-day)+p.day;
    return d<=7;
  });
  if(upcoming.length>0){
    const outgoing=upcoming.filter(p=>!p.income);
    const incoming=upcoming.filter(p=>p.income);
    if(outgoing.length>0){
      const total=outgoing.reduce((s,p)=>s+p.amt,0);
      const list=outgoing.map(p=>{
        const d=p.day>=day?p.day-day:(daysInMonth-day)+p.day;
        const when=d===0?'today':d===1?'tomorrow':'in '+d+' days';
        return p.label+' ('+fmt(p.amt)+', '+when+')';
      }).join(', ');
      const lloydsNeeded=outgoing.filter(p=>p.acc==='Lloyds current').reduce((s,p)=>s+p.amt,0);
      const covered=lloyds>=lloydsNeeded;
      insights.push({
        type:covered?'warning':'danger',icon:'📅',
        text:'Upcoming payments in the next 7 days: '+list+'. Total going out: '+fmt(total)+'. Your Lloyds current is at '+fmt(lloyds)+(covered?' which covers this — no action needed.':' which may not cover this — consider topping it up.')
      });
    }
    if(incoming.length>0){
      incoming.forEach(p=>{
        const d=p.day>=day?p.day-day:(daysInMonth-day)+p.day;
        const when=d===0?'today':d===1?'tomorrow':'in '+d+' days';
        insights.push({
          type:'positive',icon:'💸',
          text:'Salary of '+fmt(p.amt)+' lands '+when+' (£48k gross, after tax, NI and student loan). Once it hits, transfer £1,737 straight to the credit card before spending anything else.'
        });
      });
    }
  }

  // 2. Category overspend warnings
  const catWarnings=[];
  CATEGORIES.forEach(c=>{
    const s=spend[c]||0;
    const budget=parseFloat(state.budgets[c])||0;
    if(budget===0||s===0) return;
    const projected=progress>0?s/progress:s;
    const pct=s/budget;
    const overBy=projected-budget;
    if(s>budget){
      catWarnings.push({priority:3,type:'danger',icon:'⚠️',
        text:c+' is '+fmt(s-budget)+' over its '+fmt(budget)+' budget with '+daysLeft+' days still to go. You have spent '+fmt(s)+' this month — avoid any more '+c.toLowerCase()+' spend if possible.'});
    } else if(overBy>10&&pct>0.55){
      catWarnings.push({priority:2,type:'warning',icon:'📊',
        text:c+' is at '+Math.round(pct*100)+'% of budget ('+fmt(s)+' of '+fmt(budget)+') with '+Math.round(progress*100)+'% of the month gone. At this pace you will overshoot by around '+fmt(overBy)+' — pull back where you can.'});
    } else if(pct>0.75){
      catWarnings.push({priority:1,type:'warning',icon:'👀',
        text:c+' is at '+Math.round(pct*100)+'% of its '+fmt(budget)+' budget. Only '+fmt(budget-s)+' left for the rest of the month.'});
    }
  });
  catWarnings.sort((a,b)=>b.priority-a.priority);
  catWarnings.slice(0,2).forEach(w=>insights.push(w));

  // 3. Budget reduction suggestions
  if(insights.length<4){
    const sugg=Object.entries(BUDGET_SUGGESTIONS)
      .filter(([cat,s])=>(parseFloat(state.budgets[cat])||0)>s.suggested)
      .map(([cat,s])=>({cat,cur:parseFloat(state.budgets[cat]),sug:s.suggested,save:parseFloat(state.budgets[cat])-s.suggested,why:s.reason}));
    if(sugg.length>0){
      const saving=sugg.reduce((t,s)=>t+s.save,0);
      const list=sugg.map(s=>s.cat+' from '+fmt(s.cur)+' to '+fmt(s.sug)).join(', ');
      insights.push({type:'info',icon:'💡',
        text:'Your budgets have room to tighten: reduce '+list+'. That frees up '+fmt(saving)+'/month — put it straight on the credit card. '+sugg[0].why+' Adjust these in Settings.'});
    }
  }

  // 4. Cash vs credit card
  if(liquid>800&&cc>0){
    const extra=Math.max(0,liquid-400);
    insights.push({type:'positive',icon:'💳',
      text:'You have '+fmt(liquid)+' in cash. After a £400 buffer, you could move '+fmt(extra)+' to the credit card now — saving '+fmt(extra*(0.2366/12))+' in interest next month and reducing the '+fmt(cc)+' balance.'});
  } else if(liquid<100&&cc>0){
    insights.push({type:'danger',icon:'🚨',
      text:'Cash is very low at '+fmt(liquid)+'. Hold off on any credit card payments until your balance is healthier — you need enough to cover your DDs and standing orders.'});
  }

  // 5. Overall pace
  if(progress>0.3&&totalBudget>0){
    const expected=totalBudget*progress;
    const diff=expected-totalSpent;
    if(diff>50){
      insights.push({type:'positive',icon:'✅',
        text:'You are '+fmt(diff)+' under the expected spending pace — '+Math.round(progress*100)+'% through the month but only '+Math.round((totalSpent/totalBudget)*100)+'% of budget used. If this holds, transfer the surplus to the credit card at month end.'});
    } else if(diff<-50){
      insights.push({type:'warning',icon:'📉',
        text:'You are '+fmt(Math.abs(diff))+' ahead of the expected pace. With '+daysLeft+' days left, try to keep daily spend under '+fmt((totalBudget-totalSpent)/Math.max(daysLeft,1))+' to stay within budget.'});
    }
  }

  // Holiday pot removed

  // 7. Interest reminder
  if(cc>0&&insights.length<5){
    insights.push({type:'info',icon:'📈',
      text:'The credit card is costing '+fmt(interest)+' in interest this month at 23.66% APR — '+fmt(interest*12)+' a year if the balance stays flat. Every extra payment reduces this directly.'});
  }

  if(insights.length===0){
    insights.push({type:'info',icon:'📋',
      text:'Add some transactions and this section will give you personalised spending advice.'});
  }

  const colMap={danger:'#ff4444',warning:'#ffaa00',positive:'#44ff88',info:'#888888'};
  el.innerHTML=insights.slice(0,5).map(ins=>
    '<div style="display:flex;gap:10px;padding:12px 14px;border-bottom:1px solid #222;align-items:flex-start">'+
    '<div style="font-size:18px;flex-shrink:0;margin-top:1px">'+ins.icon+'</div>'+
    '<div style="font-size:13px;line-height:1.6;flex:1">'+
    '<span style="color:'+colMap[ins.type]+';font-weight:600;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:3px">'+ins.type+'</span>'+
    '<span style="color:#ccc">'+ins.text+'</span>'+
    '</div></div>'
  ).join('');
}

/* ── Render all ── */
function renderAll(){
  renderBalances();renderGlance();renderDebtMini();renderRecent();
  renderInsights();renderTransactions();renderBudget();renderDebt();renderSettings();
}

populateSelects();
loadAll();
