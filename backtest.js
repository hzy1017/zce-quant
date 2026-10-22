/* 郑商所动量策略回测 v2 — 多时间窗口 */
const fs = require('fs');
const E = require('./analyze.js');
const { live } = E;

const byDate = {};
for (const s of live) for (const r of s.rows) (byDate[r.d] = byDate[r.d] || {})[s.symbol] = r.c;

function universe(minDays) {
  return live.filter(s => s.rows.length >= minDays).map(s => s.symbol);
}

function build(syms) {
  const dates = Object.keys(byDate).sort().filter(d => syms.every(s => byDate[d][s] > 0));
  return { syms, D: dates, px: Object.fromEntries(syms.map(s => [s, dates.map(d => byDate[d][s])])) };
}

function run(U, { topK = 3, bottomK = 0, lookback = 60, rebal = 20, volTarget = null, cost = 0.0005, scale = 1 }) {
  const { syms, D, px } = U;
  const logret = {}; for (const s of syms) logret[s] = px[s].map((v, i) => i ? Math.log(v / px[s][i - 1]) : 0);
  let eq = 1, peak = 1, mdd = 0; const eqs = [], dret = [];
  let w = {}, prevW = {};
  for (let i = lookback + 1; i < D.length; i++) {
    const isRebal = (i - lookback) % rebal === 0;
    if (isRebal) {
      const sig = syms.map(s => ({ s, m: px[s][i - 1] / px[s][i - 1 - lookback] - 1 })).sort((a, b) => b.m - a.m);
      const longs = sig.slice(0, topK).map(x => x.s);
      const shorts = bottomK ? sig.slice(-bottomK).map(x => x.s) : [];
      const volOf = s => {
        const r = logret[s].slice(Math.max(0, i - 60), i);
        const m = r.reduce((a, b) => a + b, 0) / r.length;
        return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) || 0.02;
      };
      const tL = longs.reduce((a, s) => a + 1 / volOf(s), 0) || 1;
      const tS = shorts.reduce((a, s) => a + 1 / volOf(s), 0) || 1;
      const nw = {};
      for (const s of longs) nw[s] = (1 / volOf(s)) / tL;
      for (const s of shorts) nw[s] = -(1 / volOf(s)) / tS;
      if (volTarget) {
        const pv = Math.sqrt(syms.reduce((a, s) => a + (nw[s] || 0) ** 2 * volOf(s) ** 2, 0)) * Math.sqrt(244);
        const k = Math.min(4, volTarget / (pv || 1));
        for (const s in nw) nw[s] *= k;
      }
      for (const s in nw) nw[s] *= scale;
      let turn = 0;
      for (const s of new Set([...Object.keys(nw), ...Object.keys(prevW)])) turn += Math.abs((nw[s] || 0) - (prevW[s] || 0));
      w = nw;
      var costToday = turn * cost;
      prevW = { ...nw };
    } else var costToday = 0;
    let r = 0;
    for (const s in w) r += w[s] * logret[s][i];
    r -= costToday;
    eq *= Math.exp(r); dret.push(r);
    if (eq > peak) peak = eq; mdd = Math.min(mdd, eq / peak - 1);
    eqs.push(eq);
  }
  const yrs = Math.max(dret.length / 244, 0.01);
  const cagr = Math.pow(eq, 1 / yrs) - 1;
  const m = dret.reduce((a, b) => a + b, 0) / dret.length;
  const sd = Math.sqrt(dret.reduce((a, b) => a + (b - m) ** 2, 0) / (dret.length - 1));
  const dn = dret.filter(x => x < 0);
  const dsd = Math.sqrt(dn.reduce((a, b) => a + b * b, 0) / (dn.length || 1));
  return {
    eq, cagr, mdd, sharpe: m / sd * Math.sqrt(244), sortino: m / dsd * Math.sqrt(244),
    calmar: cagr / Math.abs(mdd || 1), eqs, yrs, days: dret.length, w,
  };
}

const CONFIGS = [
  ['多1 (最强1个)', { topK: 1, lookback: 60, rebal: 20 }],
  ['多3 (60日动量)', { topK: 3, lookback: 60, rebal: 20 }],
  ['多5 (60日动量)', { topK: 5, lookback: 60, rebal: 20 }],
  ['多3 (120日动量)', { topK: 3, lookback: 120, rebal: 20 }],
  ['多3 (20日动量,10日调仓)', { topK: 3, lookback: 20, rebal: 10 }],
  ['多3空3 (60日)', { topK: 3, bottomK: 3, lookback: 60, rebal: 20 }],
  ['多3空3 (120日)', { topK: 3, bottomK: 3, lookback: 120, rebal: 20 }],
  ['多5空5 (120日)', { topK: 5, bottomK: 5, lookback: 120, rebal: 20 }],
  ['等权全持有', { topK: 99, lookback: 60, rebal: 20 }],
  ['多3(120日)+30%波动目标', { topK: 3, lookback: 120, rebal: 20, volTarget: 0.30 }],
  ['多3(120日)+60%波动目标', { topK: 3, lookback: 120, rebal: 20, volTarget: 0.60 }],
  ['多3(120日)+100%波动目标', { topK: 3, lookback: 120, rebal: 20, volTarget: 1.00 }],
];

const fmtp = v => (v * 100).toFixed(1) + '%';
const report = {};

for (const [label, minDays] of [['全部20品种 (~1.2年)', 1], ['18品种 (~3年)', 600], ['16品种 (~5.6年)', 1370]]) {
  const syms = universe(minDays);
  const U = build(syms);
  console.log('\n' + '='.repeat(104));
  console.log(`${label}   品种数=${syms.length}   区间 ${U.D[0]} → ${U.D[U.D.length - 1]}  (${U.D.length}个交易日 ≈ ${(U.D.length / 244).toFixed(1)}年)`);
  console.log('='.repeat(104));
  console.log('策略                              累计收益    年化    最大回撤   夏普   索提诺   卡玛   年化波动');
  console.log('-'.repeat(104));
  report[label] = {};
  for (const [name, cfg] of CONFIGS) {
    const r = run(U, cfg);
    report[label][name] = {
      total: r.eq - 1, cagr: r.cagr, mdd: r.mdd, sharpe: r.sharpe, sortino: r.sortino, calmar: r.calmar,
    };
    const vol = r.cagr / r.calmar * Math.abs(r.mdd) / Math.abs(r.mdd || 1);
    console.log(name.padEnd(32) + fmtp(r.eq - 1).padStart(10) + fmtp(r.cagr).padStart(9) +
      fmtp(r.mdd).padStart(10) + r.sharpe.toFixed(2).padStart(8) + r.sortino.toFixed(2).padStart(8) +
      r.calmar.toFixed(2).padStart(8));
  }
}

// 当前信号（用最长历史universe）
const syms20 = universe(1);
const U20 = build(syms20);
const i = U20.D.length - 1;
console.log('\n' + '='.repeat(104));
console.log('当前动量信号（截至 ' + U20.D[i] + '）');
console.log('='.repeat(104));
for (const lb of [20, 60, 120, 250]) {
  const sig = U20.syms.map(s => ({ s, m: U20.px[s][i] / U20.px[s][i - lb] - 1 })).sort((a, b) => b.m - a.m);
  console.log(` ${String(lb).padStart(3)}日  强: ` + sig.slice(0, 5).map(x => `${x.s}${(x.m * 100).toFixed(1)}%`).join('  '));
  console.log(`      弱: ` + sig.slice(-5).map(x => `${x.s}${(x.m * 100).toFixed(1)}%`).join('  '));
}

fs.writeFileSync('D:/ai tools/zce/out/backtest.json', JSON.stringify(report, null, 1), 'utf8');
console.log('\n[已保存 out/backtest.json]');
