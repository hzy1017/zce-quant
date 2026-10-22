/* 仓位测算 v2：目标波动率法 + 保证金硬约束 */
const fs = require('fs');
const E = require('./analyze.js');
const { live, fmt, fmtNum } = E;

const L = JSON.parse(fs.readFileSync('D:/ai tools/zce/live.json', 'utf8')).list;
const CAP = 500000;
const RE = /^[A-Z]+[0-9]{3}$/;
const ADDON = 0.03;              // 期货公司保证金加收
const MAX_MARGIN = 0.80;         // 保证金占用上限（留20%缓冲防强平）

function trueMain(px) {
  const cs = L.filter(x => RE.test(x.dm) && x.dm.startsWith(px) && x.dm.length === px.length + 3 && x.p > 0 && x.ccl > 0);
  return cs.length ? cs.reduce((a, b) => b.ccl > a.ccl ? b : a) : null;
}
const rets = {};
for (const s of live) { const r = s.rows.slice(-250).map(x => x.c); rets[s.symbol] = r.slice(1).map((v, i) => Math.log(v / r[i])); }
function cov(a, b) {
  const A = rets[a], B = rets[b], n = Math.min(A.length, B.length, 120);
  const ma = A.slice(-n).reduce((x, y) => x + y, 0) / n, mb = B.slice(-n).reduce((x, y) => x + y, 0) / n;
  let s = 0; for (let i = 0; i < n; i++) s += (A[A.length - n + i] - ma) * (B[B.length - n + i] - mb);
  return s / (n - 1);
}

const M = {};
for (const s of live) {
  const m = trueMain(s.symbol.replace(/0$/, '')); if (!m) continue;
  const val = m.p * s.mult, mg = val * (s.margin + ADDON);
  M[s.symbol] = { ...s, mainDm: m.dm, price: m.p, val, mg, atrAmt: m.p * (s.atrPct / 100) * s.mult, worst: Math.min(...rets[s.symbol].slice(-250)) * 100 };
}

// ---------- 表1：单手风险 ----------
console.log('='.repeat(126));
console.log('表1  各品种单手风险（50万本金，保证金=交易所标准+期货公司加收3%）');
console.log('='.repeat(126));
console.log('品种        真实主力     最新价   乘数   1手价值  1手保证金 满仓手数 满仓时1个ATR=本金%  1个ATR金额  近250日最差单日');
console.log('-'.repeat(126));
const order = ['MA0','TA0','PX0','PL0','PR0','PF0','SA0','FG0','SH0','CJ0','AP0','SR0','CF0','RM0','OI0','UR0','SM0','SF0','PK0','CY0'];
for (const sym of order) {
  const r = M[sym]; if (!r) continue;
  const lotsFull = Math.floor(CAP / r.mg);
  const atrPctCap = lotsFull * r.atrAmt / CAP * 100;
  console.log(r.code.padEnd(10) + r.mainDm.padEnd(12) + String(r.price >= 1000 ? Math.round(r.price) : r.price.toFixed(1)).padStart(8) +
    String(r.mult).padStart(6) + fmtNum(r.val).padStart(10) + fmtNum(r.mg).padStart(10) + String(lotsFull).padStart(9) +
    (atrPctCap.toFixed(1) + '%').padStart(19) + fmtNum(r.atrAmt).padStart(11) + (r.worst.toFixed(1) + '%').padStart(17));
}
console.log('\n注：满仓=把50万全部当保证金用，是最激进的极限。1个ATR=该品种日均真实波幅；满仓时单日1个ATR的盈亏相当于本金的百分之几。');

// ---------- 组合构建 ----------
const PORT = [
  { name: 'A 纯化工三剑客', w: { MA0: 1, TA0: 1, PX0: 1 }, tgt: 0.30, note: '甲醇+PTA+二甲苯，三者相关性0.89~0.93，实为同一个赌注' },
  { name: 'B 化工三剑客+空纯碱玻璃', w: { MA0: 1, TA0: 1, PX0: 1, SA0: -0.6, FG0: -0.6 }, tgt: 0.28, note: '多强势化工、空contango弱势建材，部分对冲' },
  { name: 'C 化工+空红枣', w: { MA0: 1, TA0: 1, PX0: 0.7, CJ0: -0.8 }, tgt: 0.28, note: '红枣与化工负相关(-0.15~-0.20)，是真正的分散化' },
  { name: 'D 只多甲醇', w: { MA0: 1 }, tgt: 0.45, note: '最集中，波动最大，净值弹性最高' },
  { name: 'E 甲醇+白糖+空玻璃', w: { MA0: 1, SR0: 0.7, FG0: -0.8 }, tgt: 0.22, note: '低波动组合，化工+软商品+空建材' },
  { name: 'F 全品种等权做多', w: Object.fromEntries(order.filter(s => M[s]).map(s => [s, 1])), tgt: 0.15, note: '最分散，波动最低，很难拉开名次' },
];

console.log('\n\n' + '='.repeat(112));
console.log('表2  候选组合：按目标波动率定仓（并受"保证金≤本金80%"硬约束）');
console.log('='.repeat(112));
console.log('组合                          目标波动  实际年化波动  保证金占用  手数合计  1日95%VaR   1日99%VaR  亏50%需连续');
console.log('-'.repeat(112));

const out = [];
for (const p of PORT) {
  const syms = Object.keys(p.w).filter(s => M[s]);
  const wsum = syms.reduce((a, s) => a + Math.abs(p.w[s]), 0);
  const wn = Object.fromEntries(syms.map(s => [s, p.w[s] / wsum]));
  // 单位组合(毛暴露=1)的日波动
  let vs = 0;
  for (const a of syms) for (const b of syms) vs += wn[a] * wn[b] * cov(a, b);
  const unitDayVol = Math.sqrt(vs);
  let k = p.tgt / (unitDayVol * Math.sqrt(244));      // 毛暴露倍数
  const build = kk => syms.map(s => {
    const notional = kk * CAP * Math.abs(wn[s]);
    const lots = Math.max(0, Math.round(notional / M[s].val));
    return { s, dir: p.w[s] > 0 ? '多' : '空', lots, mg: lots * M[s].mg, code: M[s].code, mainDm: M[s].mainDm, atr: lots * M[s].atrAmt };
  });
  let det = build(k), margin = det.reduce((a, d) => a + d.mg, 0);
  // 保证金约束：超出则等比缩仓
  let scaled = false;
  while (margin > CAP * MAX_MARGIN && k > 0.01) { k *= 0.85; det = build(k); margin = det.reduce((a, d) => a + d.mg, 0); scaled = true; }
  // 重算实际波动
  const gross = det.reduce((a, d) => a + d.lots * M[d.s].val, 0) / CAP;
  let vs2 = 0;
  for (const a of syms) for (const b of syms) {
    const ga = (wn[a] > 0 ? 1 : -1) * (det.find(d => d.s === a)?.lots * M[a].val || 0) / CAP;
    const gb = (wn[b] > 0 ? 1 : -1) * (det.find(d => d.s === b)?.lots * M[b].val || 0) / CAP;
    vs2 += ga * gb * cov(a, b);
  }
  const dayVol = Math.sqrt(vs2), annVol = dayVol * Math.sqrt(244);
  const lots = det.reduce((a, d) => a + d.lots, 0);
  out.push({ ...p, det, margin, marginPct: margin / CAP * 100, annVol, dayVol, lots, scaled, gross });
  console.log(p.name.padEnd(28) + ((p.tgt * 100).toFixed(0) + '%').padStart(9) + ((annVol * 100).toFixed(1) + '%').padStart(13) +
    ((margin / CAP * 100).toFixed(0) + '%').padStart(11) + String(lots).padStart(10) +
    fmtNum(annVol / Math.sqrt(244) * 1.645 * CAP).padStart(11) + fmtNum(annVol / Math.sqrt(244) * 2.326 * CAP).padStart(12) +
    ((0.5 / dayVol).toFixed(1) + '个σ日').padStart(12));
}

console.log('\n\n=== 各组合具体下单指令（50万本金）===');
for (const p of out) {
  console.log('\n【' + p.name + '】  ' + p.note);
  console.log(`  实际年化波动 ${(p.annVol * 100).toFixed(1)}%   保证金 ${fmtNum(p.margin)}元（占本金${p.marginPct.toFixed(0)}%）   毛暴露 ${(p.gross * 100).toFixed(0)}%   共${p.lots}手${p.scaled ? '   [已因保证金上限缩仓]' : ''}`);
  for (const d of p.det) {
    const r = M[d.s];
    console.log(`    ${d.dir}  ${d.code.padEnd(6)} ${d.mainDm.padEnd(8)} ${String(d.lots).padStart(4)}手   ` +
      `合约价值${fmtNum(d.lots * r.val).padStart(9)}  保证金${fmtNum(d.mg).padStart(9)}  ` +
      `1个ATR±${fmtNum(d.atr).padStart(7)}元(${(d.atr / CAP * 100).toFixed(1)}%本金)  最差单日±${fmtNum(Math.abs(r.worst) / 100 * d.lots * r.val).padStart(8)}元`);
  }
}

// ---------- 表3：杠杆阶梯（以组合A的持仓结构为例）----------
console.log('\n\n' + '='.repeat(112));
console.log('表3  杠杆阶梯：同一持仓结构（甲醇+PTA+二甲苯各1/3）下，把波动率目标从保守拉到激进');
console.log('='.repeat(112));
console.log('目标年化波动  毛暴露   保证金占用   手数(MA/TA/PX)  1日95%VaR  亏10%需  亏30%需  亏50%需   说明');
console.log('-'.repeat(112));
const ladder = [];
for (const tgt of [0.15, 0.25, 0.35, 0.50, 0.75, 1.00, 1.50, 2.00]) {
  const syms3 = ['MA0', 'TA0', 'PX0'], wn3 = { MA0: 1 / 3, TA0: 1 / 3, PX0: 1 / 3 };
  let vs = 0; for (const a of syms3) for (const b of syms3) vs += wn3[a] * wn3[b] * cov(a, b);
  const k = tgt / (Math.sqrt(vs) * Math.sqrt(244));
  const det = syms3.map(s => ({ s, lots: Math.round(k * CAP * wn3[s] / M[s].val), mg: 0 }));
  det.forEach(d => d.mg = d.lots * M[d.s].mg);
  const margin = det.reduce((a, d) => a + d.mg, 0);
  const gross = det.reduce((a, d) => a + d.lots * M[d.s].val, 0) / CAP;
  const dvol = tgt / Math.sqrt(244);
  const note = margin > CAP * 0.8 ? '⚠ 保证金超80%上限，实际开不到' : tgt >= 1.0 ? '极高风险，几天内可能爆仓' : tgt >= 0.5 ? '激进' : tgt >= 0.3 ? '进取' : '稳健';
  console.log((tgt * 100).toFixed(0).padStart(9) + '%' + (gross * 100).toFixed(0).padStart(9) + '%' +
    ((margin / CAP * 100).toFixed(0) + '%').padStart(11) + ('  ' + det.map(d => d.lots).join('/')).padStart(17) +
    fmtNum(dvol * 1.645 * CAP).padStart(11) + (Math.ceil(Math.log(0.9) / Math.log(1 - dvol)) + '日').padStart(9) +
    (Math.ceil(Math.log(0.7) / Math.log(1 - dvol)) + '日').padStart(8) + (Math.ceil(Math.log(0.5) / Math.log(1 - dvol)) + '日').padStart(8) +
    '   ' + note);
  ladder.push({ tgt, gross, margin, marginPct: margin / CAP * 100, lots: det.map(d => d.lots), v95: dvol * 1.645 * CAP });
}
console.log('\n注：郑商所品种保证金率约10~14%，所以"保证金"几乎不构成约束——真正约束你的是波动率和爆仓风险。');

fs.writeFileSync('D:/ai tools/zce/out/risk.json', JSON.stringify({
  ladder,
  cap: CAP,
  rows: order.filter(s => M[s]).map(s => { const r = M[s]; return { symbol: s, code: r.code, mainDm: r.mainDm, price: r.price, mult: r.mult, val: r.val, mg: r.mg, lotsFull: Math.floor(CAP / r.mg), atrAmt: r.atrAmt, worst: r.worst, vol20: r.vol20, ret60: r.ret60, ret250: r.ret250, pos250: r.pos250 }; }),
  portfolios: out.map(p => ({ name: p.name, note: p.note, tgt: p.tgt, annVol: p.annVol, margin: p.margin, marginPct: p.marginPct, lots: p.lots, gross: p.gross, scaled: p.scaled, det: p.det })),
}, null, 1), 'utf8');
console.log('\n[已保存 out/risk.json]');
