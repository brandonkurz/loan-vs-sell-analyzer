/* ============================================================
   Loan vs. Sell-to-Cover Analyzer — Diversifi Capital
   Income-driven 2026 tax model. Focus: why borrowing beats/loses
   selling, short- vs long-term hold, and monthly loan cash-flow.
   ============================================================ */
const $ = id => document.getElementById(id);
const fmt  = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const fmtS = n => Math.round(n).toLocaleString('en-US');
const pct  = n => (n * 100).toFixed(1) + '%';

const readPrice = () => +$('price409a').value || 0;   // 409A / settlement price (user input; blank until entered)

/* ---- 2026 federal ordinary brackets (taxable income after std deduction) ---- */
const BRK = {
  single: [[0,.10],[12400,.12],[50400,.22],[105700,.24],[201775,.32],[256225,.35],[640600,.37]],
  mfj:    [[0,.10],[24800,.12],[100800,.22],[211400,.24],[403550,.32],[512450,.35],[768700,.37]]
};
const STD = { single: 16100, mfj: 32200 };
const NIIT = 0.038;                  // net investment income tax (ACA) on capital gains
const SS_WAGE_BASE = 184500, SS_RATE = 0.062, MEDI_RATE = 0.0145, ADDL_MEDI = 0.009;
const RATE_COLORS = { 0.10:'#9ec5e8', 0.12:'#7fb0dd', 0.22:'#5b93cf', 0.24:'#3f78bd', 0.32:'#2f5f9e', 0.35:'#27507f', 0.37:'#1d3c63' };

function fedTax(taxable, status){
  if (taxable <= 0) return 0;
  const b = BRK[status]; let tax = 0;
  for (let i = 0; i < b.length; i++){
    const lo = b[i][0], hi = i+1 < b.length ? b[i+1][0] : Infinity, rate = b[i][1];
    if (taxable > lo) tax += (Math.min(taxable, hi) - lo) * rate; else break;
  }
  return tax;
}
function topRate(income, status){
  const b = BRK[status]; let r = b[0][1];
  for (let i = 0; i < b.length; i++){ if (income > b[i][0]) r = b[i][1]; }
  return r;
}
function payrollTax(salary, rsu, status){
  const thr = status === 'mfj' ? 250000 : 200000;
  const medicare = rsu * MEDI_RATE;
  const addlBase = Math.max(0, (salary + rsu) - thr) - Math.max(0, salary - thr);
  const addlMedicare = addlBase * ADDL_MEDI;
  const ssBase = Math.max(0, Math.min(salary + rsu, SS_WAGE_BASE) - Math.min(salary, SS_WAGE_BASE));
  return medicare + addlMedicare + ssBase * SS_RATE;
}
// per-bracket split of the RSU income stacked on top of other income
function bracketSegs(status, baseTaxable, withTaxable){
  const b = BRK[status]; const segs = [];
  for (let i = 0; i < b.length; i++){
    const lo = b[i][0], hi = i+1 < b.length ? b[i+1][0] : Infinity, rate = b[i][1];
    const capHi = Math.min(withTaxable, hi);
    if (capHi <= lo) break;
    const totalIn = capHi - lo;
    const baseIn = Math.max(0, Math.min(baseTaxable, hi) - lo);
    segs.push({ rate, lo, hi, totalIn, baseIn, rsuIn: totalIn - baseIn });
  }
  return segs;
}

const S = { capitalize: 0, horizon: 'st', status: 'single' };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/* ---- RSU grants table (shares per grant; all settle at the fixed 409A) ---- */
const EXAMPLE_GRANTS = [
  { num:'ES-1001', date:'15-Mar-2022', shares:42000 },
  { num:'ES-1450', date:'01-Sep-2023', shares:38035 },
  { num:'ES-2200', date:'20-Jun-2024', shares:24000 }
];
const grantsBody = $('grantsBody');
function grantRowHTML(g){
  g = g || { num:'', date:'', shares:0 };
  return `<tr>
    <td><input class="gi" data-f="num" value="${g.num||''}" placeholder="ES-0000"></td>
    <td><input class="gi" data-f="date" value="${g.date||''}" placeholder="DD-Mon-YYYY"></td>
    <td><input class="gi num" type="number" min="0" step="1" data-f="shares" value="${g.shares||0}"></td>
    <td class="valCell">$0</td>
    <td class="noprint"><button class="delx2" title="Remove grant">✕</button></td>
  </tr>`;
}
function renderGrants(list){ grantsBody.innerHTML = (list && list.length ? list : [null]).map(grantRowHTML).join(''); }
function addGrantRow(g){ grantsBody.insertAdjacentHTML('beforeend', grantRowHTML(g)); }
function readGrants(){
  return [...grantsBody.querySelectorAll('tr')].map(tr => ({
    num:   tr.querySelector('[data-f=num]').value.trim(),
    date:  tr.querySelector('[data-f=date]').value.trim(),
    shares:+tr.querySelector('[data-f=shares]').value || 0
  }));
}
function refreshGrantCells(grants, price){
  const rows = grantsBody.querySelectorAll('tr');
  let total = 0;
  grants.forEach((g,i) => { if (rows[i]) rows[i].querySelector('.valCell').textContent = fmt(g.shares * price); total += g.shares; });
  $('gTotShares').textContent = fmtS(total);
  $('gTotValue').textContent  = fmt(total * price);
}
grantsBody.addEventListener('input', calc);
grantsBody.addEventListener('click', e => {
  if (e.target.classList.contains('delx2')) {
    e.target.closest('tr').remove();
    if (!grantsBody.querySelector('tr')) addGrantRow();
    calc();
  }
});
$('addGrant').addEventListener('click', () => { addGrantRow(); calc(); });
$('loadExample').addEventListener('click', () => { renderGrants(EXAMPLE_GRANTS); calc(); });

/* ---- Loan sources (each with a capacity & rate; blended cheapest-first) ---- */
const SOURCE_TYPES = [
  { name:'Pledged Asset Line (SBLOC)', rate:6.0 },
  { name:'Box Spread Loan',            rate:4.5 },
  { name:'Margin Loan',                rate:6.5 },
  { name:'HELOC',                      rate:7.5 },
  { name:'Family Loan',                rate:5.0 },
  { name:'Personal Loan',              rate:11.0 },
  { name:'401(k) Loan',                rate:8.5 },
  { name:'Balance Transfer (promo)',   rate:0.0 },
  { name:'Other',                      rate:8.0 }
];
const DEFAULT_SOURCES = [
  { type:'Box Spread Loan',            amount:400000,  rate:4.5 },
  { type:'Family Loan',                amount:250000,  rate:5.0 },
  { type:'Pledged Asset Line (SBLOC)', amount:2000000, rate:6.0 },
  { type:'HELOC',                      amount:500000,  rate:7.5 }
];
const srcBody = $('srcBody');
function srcRowHTML(s){
  s = s || { type:'Other', amount:0, rate:8.0 };
  const opts = SOURCE_TYPES.map(t => `<option value="${t.name}"${t.name===s.type?' selected':''}>${t.name}</option>`).join('');
  return `<tr>
    <td><select class="gi" data-f="type">${opts}</select></td>
    <td><input class="gi num" type="number" min="0" step="10000" data-f="amount" value="${s.amount||0}"></td>
    <td><input class="gi num" type="number" min="0" max="30" step="0.05" data-f="rate" value="${s.rate!=null?s.rate:0}"></td>
    <td class="drawCell">$0</td>
    <td class="noprint"><button class="delx2" title="Remove source">✕</button></td>
  </tr>`;
}
function renderSources(list){ srcBody.innerHTML = (list && list.length ? list : [null]).map(srcRowHTML).join(''); }
function addSrcRow(s){ srcBody.insertAdjacentHTML('beforeend', srcRowHTML(s)); }
function readSources(){
  return [...srcBody.querySelectorAll('tr')].map(tr => ({
    type:   tr.querySelector('[data-f=type]').value,
    amount:+tr.querySelector('[data-f=amount]').value || 0,
    rate:  +tr.querySelector('[data-f=rate]').value   || 0     // percent
  }));
}
// draw `needed` dollars from the cheapest sources first; return per-source draw, blended rate (%), capacity
function drawSources(sources, needed){
  const order = sources.map((s,i) => ({ ...s, i })).sort((a,b) => a.rate - b.rate);
  const drawn = new Array(sources.length).fill(0);
  let remaining = needed, drawnTotal = 0, weighted = 0;
  for (const s of order){
    if (remaining <= 0) break;
    const take = Math.min(s.amount, remaining);
    drawn[s.i] = take; drawnTotal += take; weighted += take * s.rate; remaining -= take;
  }
  return { drawn, drawnTotal, blended: drawnTotal > 0 ? weighted / drawnTotal : 0,
           capacity: sources.reduce((a,s) => a + s.amount, 0) };
}
function refreshSourceCells(R){
  const rows = srcBody.querySelectorAll('tr');
  (R.drawn || []).forEach((d,i) => { if (rows[i]) rows[i].querySelector('.drawCell').textContent = d > 0 ? fmt(d) : '—'; });
  $('sTotCap').textContent  = fmt(R.capacity);
  $('sBlended').textContent = R.loanAmount > 0 ? pct(R.blendedRate) : '—';
  $('sDrawn').textContent   = fmt(R.loanAmount);
}
srcBody.addEventListener('input', e => {
  if (e.target.matches('select[data-f=type]')) {                    // pick a type → prefill its default rate
    const t = SOURCE_TYPES.find(x => x.name === e.target.value);
    const rInp = e.target.closest('tr').querySelector('[data-f=rate]');
    if (t && rInp) rInp.value = t.rate;
  }
  calc();
});
srcBody.addEventListener('click', e => {
  if (e.target.classList.contains('delx2')) {
    e.target.closest('tr').remove();
    if (!srcBody.querySelector('tr')) addSrcRow();
    calc();
  }
});
$('addSrc').addEventListener('click', () => { addSrcRow(); calc(); });
$('loadSrc').addEventListener('click', () => { renderSources(DEFAULT_SOURCES); calc(); });

function readInputs(){
  const grants = readGrants();
  return {
    grants,
    shares:      grants.reduce((s,g) => s + g.shares, 0),
    price:       readPrice(),
    sources:     readSources(),
    otherIncome: +$('otherIncome').value || 0,
    stateRate:   (+$('stateRate').value  || 0) / 100,
    ltFed:       (+$('ltFed').value       || 0) / 100,
    shortM:      clamp(Math.round(+$('shortM').value) || 6, 1, 11),
    longM:       clamp(Math.round(+$('longM').value) || 18, 12, 60),
    future:      +$('futureR').value      || 0,
    capitalize: S.capitalize, horizon: S.horizon, status: S.status
  };
}

/* ---- pure model ---- */
function compute(I){
  const N = I.shares, p = I.price, F = I.future, status = I.status;

  // settlement tax: RSU income stacked on other income through 2026 brackets, + state + payroll
  const rsuIncome   = N * p;
  const baseTaxable = Math.max(0, I.otherIncome - STD[status]);
  const withTaxable = Math.max(0, I.otherIncome + rsuIncome - STD[status]);
  const fedOnRSU    = fedTax(withTaxable, status) - fedTax(baseTaxable, status);
  const stateOnRSU  = rsuIncome * I.stateRate;
  const payrollOnRSU= payrollTax(I.otherIncome, rsuIncome, status);
  const taxesDue    = fedOnRSU + stateOnRSU + payrollOnRSU;
  const settleEff   = rsuIncome > 0 ? taxesDue / rsuIncome : 0;

  // capital-gains rates (NIIT applies to both; state on both)
  const marginalOrd = topRate(withTaxable, status);
  const stCgRate = marginalOrd + NIIT + I.stateRate;   // short-term = ordinary + NIIT + state
  const ltCgRate = I.ltFed + NIIT + I.stateRate;        // long-term  = 20% + NIIT + state

  const gainPS = Math.max(0, F - p);
  // sell-to-cover: sell enough shares for the full tax
  const sharesSold = Math.min(N, p > 0 ? Math.ceil(taxesDue / p) : 0);
  const remain = N - sharesSold;

  // borrow-to-cover: draw available sources (cheapest first) up to the tax; sell shares for any shortfall
  const draw = drawSources(I.sources || [], taxesDue);
  const capacity = draw.capacity;
  const loanAmount = Math.min(taxesDue, capacity);
  const shortfall = Math.max(0, taxesDue - loanAmount);
  const blendedRate = draw.blended / 100;
  const shortfallShares = Math.min(N, p > 0 ? Math.ceil(shortfall / p) : 0);
  const keptBorrow = N - shortfallShares;
  const deltaShares = sharesSold - shortfallShares;      // shares borrowing saves from being sold

  const interest = months => I.capitalize
    ? loanAmount * (Math.pow(1 + blendedRate / 12, months) - 1)
    : loanAmount * blendedRate * months / 12;

  const sellTakeHome   = rate           => remain * F - remain * gainPS * rate;
  const borrowTakeHome = (rate, months) => keptBorrow * F - keptBorrow * gainPS * rate - loanAmount - interest(months);

  const sellST = sellTakeHome(stCgRate),  sellLT = sellTakeHome(ltCgRate);
  const intST  = interest(I.shortM),      intLT  = interest(I.longM);
  const borrowST = borrowTakeHome(stCgRate, I.shortM);
  const borrowLT = borrowTakeHome(ltCgRate, I.longM);

  const advST = borrowST - sellST, advLT = borrowLT - sellLT;

  const g = I.horizon === 'lt' ? ltCgRate : stCgRate;
  const months = I.horizon === 'lt' ? I.longM : I.shortM;
  const intH = interest(months);
  const breakeven = deltaShares > 0 && g < 1 ? ((loanAmount + intH) / deltaShares - p * g) / (1 - g) : null;

  return { N, p, F, borrowRate: blendedRate, blendedRate, capacity, loanAmount, shortfall, shortfallShares, keptBorrow, deltaShares, drawn: draw.drawn,
           gross: rsuIncome, rsuIncome, status,
           baseTaxable, withTaxable, fedOnRSU, stateOnRSU, payrollOnRSU, taxesDue, settleEff,
           marginalOrd, stCgRate, ltCgRate, gainPS, sharesSold, remain,
           intST, intLT, sellST, sellLT, borrowST, borrowLT, advST, advLT, interest, breakeven };
}

/* ---- segmented controls + inputs ---- */
function segWire(id, key, cb){
  document.querySelectorAll('#' + id + ' button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#' + id + ' button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      const v = btn.dataset.v;
      S[key] = /^-?\d+$/.test(v) ? +v : v;
      if (cb) cb(); calc();
    });
  });
}
segWire('seg-cap', 'capitalize');
segWire('seg-horizon', 'horizon');
segWire('seg-status', 'status');
['price409a','otherIncome','stateRate','ltFed','shortM','longM'].forEach(id => { const el = $(id); if (el) el.addEventListener('input', calc); });
// Snap the hold-period fields into range once the user finishes editing (blur),
// so partial typing (e.g. "1" on the way to "18") never sticks as an invalid value.
$('shortM').addEventListener('change', () => { $('shortM').value = clamp(Math.round(+$('shortM').value) || 6, 1, 11); calc(); });
$('longM').addEventListener('change',  () => { $('longM').value  = clamp(Math.round(+$('longM').value) || 18, 12, 60); calc(); });
$('futureR').addEventListener('input', () => { $('futureV').textContent = '$' + (+$('futureR').value); calc(); });

/* ---- month labels (browser Date is fine) ---- */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function monthLabel(offset){ const start = 7 + offset; return MONTHS[start % 12] + '-' + String(2026 + Math.floor(start / 12)).slice(2); }

/* ---- tab switching ---- */
function setTab(t){
  const main = t === 'main';
  $('viewMain').style.display = main ? 'block' : 'none';
  $('viewIncome').style.display = main ? 'none' : 'block';
  $('tabMain').classList.toggle('on', main);
  $('tabIncome').classList.toggle('on', !main);
}
$('tabMain').addEventListener('click', () => setTab('main'));
$('tabIncome').addEventListener('click', () => setTab('income'));
$('printBtn').addEventListener('click', () => window.print());

/* ============================================================ RENDER */
function calc(){
  const I = readInputs(), R = compute(I);
  refreshGrantCells(I.grants, I.price);
  refreshSourceCells(R);
  $('grossV').textContent     = fmt(R.gross);
  $('sharesEcho').textContent = fmtS(R.N);
  $('g409a').textContent      = I.price.toFixed(2);
  $('ratesRO').innerHTML      = `Settlement: <b>${pct(R.settleEff)}</b><br>Short-term gains: <b>${pct(R.stCgRate)}</b><br>Long-term gains: <b>${pct(R.ltCgRate)}</b>`;
  $('loanRO').innerHTML       = R.loanAmount > 0 ? `<b>${pct(R.blendedRate)}</b> on ${fmt(R.loanAmount)} · capacity ${fmt(R.capacity)}` : `No loan sources`;
  $('futureV').textContent    = '$' + I.future;
  $('fpLbl').textContent      = '$' + I.future;
  const cov = R.taxesDue > 0 ? R.loanAmount / R.taxesDue : 0;
  const has401k = (I.sources || []).some((s,i) => s.type === '401(k) Loan' && (R.drawn[i] || 0) > 0);
  $('srcNote').innerHTML = `Total capacity <b>${fmt(R.capacity)}</b> covers <b>${pct(cov)}</b> of the <b>${fmt(R.taxesDue)}</b> tax bill. Cheapest sources are drawn first, for a blended rate of <b>${R.loanAmount>0?pct(R.blendedRate):'—'}</b> on the <b>${fmt(R.loanAmount)}</b> borrowed.` +
    (R.shortfall > 0
      ? ` <b style="color:var(--bad)">Shortfall of ${fmt(R.shortfall)}</b> exceeds available credit → <b>${fmtS(R.shortfallShares)} shares</b> must still be sold to cover it.`
      : ` The loan fully covers the tax — <b>no shares sold</b>.`) +
    (has401k ? ` <b style="color:var(--amber)">401(k) loan note:</b> capped at the lesser of $50,000 or 50% of the vested balance, and typically becomes due in full if employment ends — unpaid balances are treated as a taxable (and possibly penalized) distribution.` : '');

  const isLT = I.horizon === 'lt';
  const adv  = isLT ? R.advLT : R.advST;
  const hMonths = isLT ? I.longM : I.shortM;

  // hero
  $('hero').classList.toggle('neg', adv < 0);
  $('heroLab').textContent = adv >= 0
    ? `Borrowing & holding ${isLT ? 'long-term' : 'short-term'} nets more than selling to cover by`
    : `Borrowing & holding ${isLT ? 'long-term' : 'short-term'} costs more than selling to cover by`;
  $('heroBig').textContent = fmt(Math.abs(adv));
  $('heroSub').innerHTML = adv >= 0
    ? `At $${I.future}, borrowing <b>${fmt(R.loanAmount)}</b> (blended ${pct(R.blendedRate)}) keeps <b>${fmtS(R.deltaShares)} more shares</b> than selling to cover — worth more than the <b>${fmt(isLT ? R.intLT : R.intST)}</b> of interest carried.`
    : `At $${I.future}, the <b>${fmt(isLT ? R.intLT : R.intST)}</b> of loan interest${isLT ? '' : ' plus the short-term tax rate'} outweighs the ${fmtS(R.deltaShares)} shares borrowing keeps. Borrowing pays off above the breakeven price below.`;
  $('heroPill').textContent = `${isLT ? 'Long-term' : 'Short-term'} hold · ${hMonths} mo · borrow @ ${pct(R.borrowRate)}` +
    (R.breakeven != null ? ` · breakeven ≈ $${R.breakeven.toFixed(2)}` : '');

  // matrix
  const row = (label, a, b, c, d, cls) => `<tr class="${cls||''}"><td class="lbl">${label}</td><td>${a}</td><td>${b}</td><td>${c}</td><td>${d}</td></tr>`;
  const dash = '—';
  let m = '';
  m += `<tr class="grp-row"><td colspan="5">At settlement</td></tr>`;
  m += row('Gross RSU value', fmt(R.gross), fmt(R.gross), fmt(R.gross), fmt(R.gross));
  m += row('Tax due at settlement', fmt(R.taxesDue), fmt(R.taxesDue), fmt(R.taxesDue), fmt(R.taxesDue));
  m += row('Loan amount (capacity-capped)', dash, fmt(R.loanAmount), dash, fmt(R.loanAmount));
  m += row('Shares sold for taxes', fmtS(R.sharesSold), fmtS(R.shortfallShares), fmtS(R.sharesSold), fmtS(R.shortfallShares));
  m += row('Shares kept', fmtS(R.remain), fmtS(R.keptBorrow), fmtS(R.remain), fmtS(R.keptBorrow), 'sumrow');
  m += `<tr class="grp-row"><td colspan="5">At sale ($${I.future})</td></tr>`;
  m += row('Gross proceeds', fmt(R.remain * R.F), fmt(R.keptBorrow * R.F), fmt(R.remain * R.F), fmt(R.keptBorrow * R.F));
  m += row('Gross gain before interest & taxes', fmt(R.remain * R.gainPS), fmt(R.keptBorrow * R.gainPS), fmt(R.remain * R.gainPS), fmt(R.keptBorrow * R.gainPS));
  m += row('Capital-gains tax', '-' + fmt(R.remain * R.gainPS * R.stCgRate), '-' + fmt(R.keptBorrow * R.gainPS * R.stCgRate), '-' + fmt(R.remain * R.gainPS * R.ltCgRate), '-' + fmt(R.keptBorrow * R.gainPS * R.ltCgRate));
  m += row('Loan interest', dash, '-' + fmt(R.intST), dash, '-' + fmt(R.intLT));
  m += row('Loan principal repaid', dash, '-' + fmt(R.loanAmount), dash, '-' + fmt(R.loanAmount));
  m += row('Take-home', fmt(R.sellST), fmt(R.borrowST), fmt(R.sellLT), fmt(R.borrowLT), 'sumrow');
  m += row('Advantage of borrowing', '', `<span class="${R.advST>=0?'pos':'neg'}">${(R.advST<0?'-':'+')+fmt(Math.abs(R.advST))}</span>`, '', `<span class="${R.advLT>=0?'pos':'neg'}">${(R.advLT<0?'-':'+')+fmt(Math.abs(R.advLT))}</span>`, 'advrow');
  $('mtxBody').innerHTML = m;

  // waterfall
  const cgRateH = isLT ? R.ltCgRate : R.stCgRate;
  $('wfHint').textContent = `${isLT ? 'long-term' : 'short-term'} hold @ $${I.future}`;
  const dS = R.deltaShares;
  const sharesKeptValue = dS * R.F;
  const cgOnExtra = dS * R.gainPS * cgRateH;
  const intCost = isLT ? R.intLT : R.intST;
  const wf = [
    { lab:`Value of ${fmtS(dS)} extra shares kept @ $${I.future}`, val: sharesKeptValue, pos:true },
    { lab:'− Cap-gains tax on those shares', val: -cgOnExtra, pos:false },
    { lab:'− Loan repaid (borrowed to keep them)', val: -R.loanAmount, pos:false },
    { lab:'− Loan interest', val: -intCost, pos:false }
  ];
  const wfMax = Math.max(...wf.map(w => Math.abs(w.val)), 1);
  $('waterfall').innerHTML = wf.map(w => {
    const width = Math.max(6, Math.abs(w.val) / wfMax * 100);
    const inLabel = width >= 24 ? `${w.val>=0?'+':''}${fmt(w.val)}` : '';   // only label wide bars; narrow ones read from the right column
    return `<div class="wf-row"><div class="wf-lab">${w.lab}</div>
      <div class="wf-bar"><div class="wf-fill" style="width:${width}%;background:${w.pos?'var(--good)':'var(--bad)'}">${inLabel}</div></div>
      <div class="wf-amt ${w.pos?'pos':'neg'}">${w.val>=0?'+':''}${fmt(w.val)}</div></div>`;
  }).join('') +
  `<div class="wf-row" style="border-top:2px solid var(--gold);padding-top:8px;margin-top:6px"><div class="wf-lab"><b>Net advantage of borrowing</b></div>
    <div class="wf-bar"></div><div class="wf-amt ${adv>=0?'pos':'neg'}"><b>${adv>=0?'+':''}${fmt(adv)}</b></div></div>`;
  $('wfNote').innerHTML = `Borrowing keeps <b>${fmtS(dS)} more shares</b> than selling to cover — funded by the <b>${fmt(R.loanAmount)}</b> loan instead of selling them at today's $${I.price.toFixed(2)}. Those shares ride to $${I.future}; borrowing wins when their value beats the loan repaid + the <b>${pct(cgRateH)}</b> cap-gains tax + <b>${fmt(intCost)}</b> interest. Net: <b class="${adv>=0?'pos':'neg'}">${adv>=0?'+':''}${fmt(adv)}</b>.`;

  // short-term vs long-term
  const taxSaved = R.keptBorrow * R.gainPS * (R.stCgRate - R.ltCgRate);
  const extraInt = R.intLT - R.intST;
  const ltEdge = R.borrowLT - R.borrowST;
  $('stltCards').innerHTML = `
    <div class="mini good"><div class="t">Tax saved by holding to long-term</div><div class="v">${fmt(taxSaved)}</div><div class="d">${pct(R.stCgRate)} → ${pct(R.ltCgRate)} on ${fmtS(R.keptBorrow)} shares' gain</div></div>
    <div class="mini bad"><div class="t">Extra interest (${I.shortM}→${I.longM} mo)</div><div class="v">${fmt(extraInt)}</div><div class="d">${R.borrowRate>0?pct(R.borrowRate)+' on '+fmt(R.taxesDue):''}</div></div>
    <div class="mini ${ltEdge>=0?'good':'bad'}"><div class="t">Net edge of long-term hold</div><div class="v">${ltEdge>=0?'+':''}${fmt(ltEdge)}</div><div class="d">borrow-LT take-home vs borrow-ST</div></div>`;
  $('stltNote').innerHTML = `Holding past 12 months drops the gain rate from <b>${pct(R.stCgRate)}</b> (ordinary + NIIT + state) to <b>${pct(R.ltCgRate)}</b> (20% + NIIT + state) — worth <b>${fmt(taxSaved)}</b> at $${I.future} — while adding <b>${fmt(extraInt)}</b> of interest for the extra ${I.longM-I.shortM} months. Net, the long-term hold is <b>${ltEdge>=0?'better by '+fmt(ltEdge):'worse by '+fmt(-ltEdge)}</b>.`;

  // monthly schedule
  $('schedHint').textContent = `${fmt(R.loanAmount)} @ ${pct(R.blendedRate)} blended · ${I.capitalize ? 'capitalizing' : 'interest-only'} · shares to cover @ $${I.future}`;
  let sched = '', debt = R.loanAmount, cumInt = 0;
  const monthlyR = R.blendedRate / 12;
  for (let mo = 1; mo <= I.longM; mo++){
    const start = debt, monthInt = start * monthlyR;
    cumInt += monthInt;
    const end = I.capitalize ? start + monthInt : R.loanAmount;   // interest-only: principal stays at the drawn loan
    debt = end;
    const sharesCover = R.F > 0 ? Math.ceil(cumInt / R.F) : 0;
    const flag = (mo === I.shortM || mo === I.longM) ? ' style="background:#eef5ff;font-weight:700"' : '';
    sched += `<tr${flag}><td>${monthLabel(mo - 1)} <span style="color:var(--mut)">(mo ${mo})</span></td>
      <td>${fmt(start)}</td><td>${fmt(monthInt)}</td><td>${I.capitalize ? 'capitalized' : 'paid ' + fmt(monthInt)}</td>
      <td>${fmt(end)}</td><td>${fmt(cumInt)}</td><td>${fmtS(sharesCover)} sh</td></tr>`;
  }
  $('schedBody').innerHTML = sched;
  $('schedNote').innerHTML = I.capitalize
    ? `Interest compounds into the balance — by month ${I.longM} the debt grows to <b>${fmt(debt)}</b> (<b>${fmt(cumInt)}</b> of interest). Highlighted rows are your short- and long-term sale months.`
    : `Interest-only: you pay <b>${fmt(R.loanAmount * monthlyR)}/month</b> and repay the <b>${fmt(R.loanAmount)}</b> principal at sale. Total interest over ${I.longM} months: <b>${fmt(cumInt)}</b>. Highlighted rows are your short- and long-term sale months.`;

  // sensitivity
  $('sensHorizon').textContent = isLT ? 'long-term' : 'short-term';
  const prices = [40,50,60,70,80,90,100,120,140];
  if (!prices.includes(Math.round(I.future))) { prices.push(Math.round(I.future)); prices.sort((a,b)=>a-b); }
  const rows = prices.map(P => {
    const RR = compute({ ...I, future: P });
    const s = isLT ? RR.sellLT : RR.sellST, b = isLT ? RR.borrowLT : RR.borrowST;
    return { P, s, b, a: b - s };
  });
  const maxA = Math.max(...rows.map(r => Math.abs(r.a)), 1);
  $('sensBody').innerHTML = rows.map(r => {
    const cur = Math.round(I.future) === r.P;
    const w = Math.abs(r.a) / maxA * 90;
    const bar = `<span class="bar-cell" style="width:${w}px;background:${r.a>=0?'var(--good)':'var(--bad)'}"></span>`;
    return `<tr class="${cur?'cur':''}"><td>$${r.P}${cur?' ◀ current':''}</td><td>${fmt(r.s)}</td><td>${fmt(r.b)}</td><td class="${r.a>=0?'pos':'neg'}">${r.a>=0?'+':''}${fmt(r.a)}${bar}</td></tr>`;
  }).join('');
  $('sensNote').innerHTML = R.breakeven != null
    ? `Borrowing (${isLT?'long-term':'short-term'}) beats selling to cover above a future price of about <b>$${R.breakeven.toFixed(2)}</b>. Below that, selling to cover wins because the retained upside no longer covers the interest${isLT?'':' and short-term tax'}.`
    : `Adjust inputs to see the breakeven price.`;

  renderIncome(I, R);
}

/* ---- Income & Tax tab ---- */
function renderIncome(I, R){
  const totalOrd = I.otherIncome + R.rsuIncome;
  $('incBig').textContent = fmt(R.taxesDue);
  $('incSub').innerHTML = `Tax at settlement on <b>${fmt(R.rsuIncome)}</b> of RSU income stacked on <b>${fmt(I.otherIncome)}</b> of other 2026 income — an effective <b>${pct(R.settleEff)}</b>.`;
  $('incPill').textContent = `${I.status === 'mfj' ? 'Married/Joint' : 'Single'} · top marginal ${pct(R.marginalOrd)} · state ${pct(I.stateRate)}`;
  $('incBarHint').textContent = `taxable income ${fmt(R.withTaxable)}`;

  const segs = bracketSegs(I.status, R.baseTaxable, R.withTaxable);
  const totalW = R.withTaxable || 1;
  // bar: grey base block, then RSU segments by bracket
  let bar = `<div class="seg base" style="width:${(R.baseTaxable/totalW*100).toFixed(2)}%" title="Other income (fills lower brackets)">${R.baseTaxable/totalW>0.08?'Other income':''}</div>`;
  segs.forEach(s => {
    if (s.rsuIn <= 0) return;
    const w = s.rsuIn / totalW * 100;
    bar += `<div class="seg" style="width:${w.toFixed(2)}%;background:${RATE_COLORS[s.rate]||'#3f78bd'}" title="${pct(s.rate)} bracket: ${fmt(s.rsuIn)} of RSU income">${w>5?pct(s.rate):''}</div>`;
  });
  $('incBar').innerHTML = bar;
  const usedRates = segs.filter(s => s.rsuIn > 0);
  $('incLegend').innerHTML = `<span><i class="dot base"></i>Other income <b>${fmt(R.baseTaxable)}</b></span>` +
    usedRates.map(s => `<span><i class="dot" style="background:${RATE_COLORS[s.rate]||'#3f78bd'}"></i>${pct(s.rate)} <b>${fmt(s.rsuIn)}</b></span>`).join('');

  // ladder table
  $('ladderBody').innerHTML = usedRates.map(s => {
    const hiLabel = isFinite(s.hi) ? fmt(s.hi) : '+';
    return `<tr><td>${fmt(s.lo)} – ${hiLabel}</td><td>${pct(s.rate)}</td><td>${fmt(s.rsuIn)}</td><td>${fmt(s.rsuIn * s.rate)}</td></tr>`;
  }).join('') +
  `<tr class="sumrow" style="font-weight:800;background:#f1f6fb"><td>Federal tax on RSU income</td><td>${pct(R.fedOnRSU / (R.rsuIncome||1))}</td><td>${fmt(R.rsuIncome)}</td><td>${fmt(R.fedOnRSU)}</td></tr>`;

  // cards
  $('incCards').innerHTML = `
    <div class="mini neutral"><div class="t">Total 2026 ordinary income</div><div class="v">${fmt(totalOrd)}</div><div class="d">${fmt(I.otherIncome)} other + ${fmt(R.rsuIncome)} RSU</div></div>
    <div class="mini bad"><div class="t">Tax at settlement</div><div class="v">${fmt(R.taxesDue)}</div><div class="d">effective ${pct(R.settleEff)} on RSU income</div></div>
    <div class="mini good"><div class="t">Capital-gains rates</div><div class="v" style="font-size:20px">ST ${pct(R.stCgRate)} · LT ${pct(R.ltCgRate)}</div><div class="d">both include 3.8% NIIT + ${pct(I.stateRate)} state</div></div>`;
  $('incNote').innerHTML = `Settlement tax = federal <b>${fmt(R.fedOnRSU)}</b> (marginal, stacked) + state <b>${fmt(R.stateOnRSU)}</b> + payroll/Medicare <b>${fmt(R.payrollOnRSU)}</b> = <b>${fmt(R.taxesDue)}</b>. Short-term gains are taxed at your top ordinary rate (<b>${pct(R.marginalOrd)}</b>) + 3.8% NIIT + state = <b>${pct(R.stCgRate)}</b>; long-term at <b>${pct(I.ltFed)}</b> + 3.8% + state = <b>${pct(R.ltCgRate)}</b>.`;
}

renderGrants(EXAMPLE_GRANTS);
renderSources(DEFAULT_SOURCES);
calc();
