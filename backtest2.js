/* 移仓调整序列体检 + 基于调整序列的动量回测 */
const fs = require('fs');
const E = require('./analyze.js');
const { live } = E;
const A = JSON.parse(fs.readFileSync('D:/ai tools/zce/out/adj_series.json', 'utf8'));

console.log('=== 体检1：调整序列末期是否等于真实主力价 ===');
const L = JSON.parse(fs.readFileSync('D:/ai tools/zce/live.json', 'utf8')).list;
const RE = /^[A-Z]+[0-9]{3}$/;
for (const code of ['MA', 'TA', 'UR', 'FG', 'RM', 'CJ', 'SA', 'SR']) {
  const s = A[code]; if (!s) continue;
  const last = s[s.length - 1];
  const c = L.find(x => x.dm === last.m);
  console.log(`  ${code}  调整序列末日 ${last.d} 主力=${last.m} 指数=${last.i.toFixed(1)}  实时盘中价=${c ? c.p : '?'}`);
}

console.log('\n=== 体检2：日收益离群值（|日收益|>8% 的天数）===');
console.log('品种  样本天数  离群天数  最大单日   最小单日   年化波动');
for (const code of Object.keys(A)) {
  const s = A[code];
  const r = [];
  for (let i = 1; i < s.length; i++) r.push(Math.log(s[i].i / s[i - 1].i));
  const big = r.filter(x => Math.abs(x) > 0.08).length;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  console.log(`${code.padEnd(6)}${String(s.length).padStart(8)}${String(big).padStart(10)}` +
    `${(Math.max(...r) * 100).toFixed(1).padStart(11)}%${(Math.min(...r) * 100).toFixed(1).padStart(10)}%${(sd * Math.sqrt(244) * 100).toFixed(1).padStart(11)}%`);
}

// ============ 基于调整序列的动量回测 ============
console.log('\n\n' + '='.repeat(100));
console.log('基于"真实移仓调整"序列的动量回测（无移仓跳空偏差）');
console.log('='.repeat(100));

const idx = {}; const allDates = new Set();
for (const c of Object.keys(A)) { idx[c] = new Map(A[c].map(x => [x.d, x.i])); A[c].forEach(x => allDates.add(x.d)); }
const dates = [...allDates].sort();

function build(minBars) {
  const codes = Object.keys(A).filter(c => A[c].length >= minBars);
  // 共同日期
  const D = dates.filter(d => codes.every(c => idx[c].has(d)));
  return { codes, D };
}

function run(codes, D, { topK = 3, bottomK = 0, lookback = 60, rebal = 20, volTarget = null, cost = 0.0005 }) {
  const px = {}; for (const c of codes) px[c] = D.map(d => idx[c].get(d));
  const lr = {}; for (const c of codes) lr[c] = px[c].map((v, i) => i ? Math.log(v / px[c][i - 1]) : 0);
  let eq = 1, peak = 1, mdd = 0; const dr = []; let w = {}, prevW = {};
  for (let i = lookback + 1; i < D.length; i++) {
    const isR = (i - lookback) % rebal === 0;
    let cToday = 0;
    if (isR) {
      const sig = codes.map(c => ({ c, m: px[c][i - 1] / px[c][i - 1 - lookback] - 1 })).sort((a, b) => b.m - a.m);
      const longs = sig.slice(0, topK).map(x => x.c), shorts = bottomK ? sig.slice(-bottomK).map(x => x.c) : [];
      const volOf = c => { const r = lr[c].slice(Math.max(0, i - 60), i); const m = r.reduce((a, b) => a + b, 0) / r.length; return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) || 0.02; };
      const tL = longs.reduce((a, c) => a + 1 / volOf(c), 0) || 1, tS = shorts.reduce((a, c) => a + 1 / volOf(c), 0) || 1;
      const nw = {};
      for (const c of longs) nw[c] = (1 / volOf(c)) / tL;
      for (const c of shorts) nw[c] = -(1 / volOf(c)) / tS;
      if (volTarget) { const pv = Math.sqrt(codes.reduce((a, c) => a + (nw[c] || 0) ** 2 * volOf(c) ** 2, 0)) * Math.sqrt(244); const k = Math.min(4, volTarget / (pv || 1)); for (const c in nw) nw[c] *= k; }
      let turn = 0; for (const c of new Set([...Object.keys(nw), ...Object.keys(prevW)])) turn += Math.abs((nw[c] || 0) - (prevW[c] || 0));
      cToday = turn * cost; w = nw; prevW = { ...nw };
    }
    let r = 0; for (const c in w) r += w[c] * lr[c][i];
    r -= cToday; eq *= Math.exp(r); dr.push(r);
    if (eq > peak) peak = eq; mdd = Math.min(mdd, eq / peak - 1);
  }
  const yrs = dr.length / 244, cagr = Math.pow(eq, 1 / yrs) - 1;
  const m = dr.reduce((a, b) => a + b, 0) / dr.length;
  const sd = Math.sqrt(dr.reduce((a, b) => a + (b - m) ** 2, 0) / (dr.length - 1));
  return { eq, cagr, mdd, sharpe: m / sd * Math.sqrt(244), yrs, days: dr.length };
}

const CONFIGS = [
  ['多1 (60日)', { topK: 1, lookback: 60 }],
  ['多3 (60日)', { topK: 3, lookback: 60 }],
  ['多3 (120日)', { topK: 3, lookback: 120 }],
  ['多3 (20日,10日调仓)', { topK: 3, lookback: 20, rebal: 10 }],
  ['多3空3 (60日)', { topK: 3, bottomK: 3, lookback: 60 }],
  ['多3空3 (120日)', { topK: 3, bottomK: 3, lookback: 120 }],
  ['多3空3 (250日)', { topK: 3, bottomK: 3, lookback: 250 }],
  ['等权全持有', { topK: 99, lookback: 60 }],
];

for (const [label, minBars] of [['全部20品种', 200], ['17品种(≥700日)', 700], ['14品种(≥1200日)', 1200]]) {
  const { codes, D } = build(minBars);
  if (D.length < 300) { console.log(`\n${label}: 共同交易日不足 (${D.length})，跳过`); continue; }
  console.log(`\n${label}  品种=${codes.length}  ${D[0]} → ${D[D.length - 1]}  (${D.length}日 ≈ ${(D.length / 244).toFixed(1)}年)`);
  console.log('策略                        累计收益    年化     最大回撤   夏普');
  console.log('-'.repeat(76));
  for (const [n, cfg] of CONFIGS) {
    const r = run(codes, D, cfg);
    console.log(n.padEnd(28) + ((r.eq - 1) * 100).toFixed(1).padStart(9) + '%' +
      (r.cagr * 100).toFixed(1).padStart(8) + '%' + (r.mdd * 100).toFixed(1).padStart(10) + '%' + r.sharpe.toFixed(2).padStart(8));
  }
}
