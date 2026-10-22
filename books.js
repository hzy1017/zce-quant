/* 推荐组合评估：相关性 + 风险 + 下单明细 */
const fs = require('fs');
const E = require('./analyze.js');
const { live, fmtNum } = E;
const A = JSON.parse(fs.readFileSync('D:/ai tools/zce/out/adj_series.json', 'utf8'));
const L = JSON.parse(fs.readFileSync('D:/ai tools/zce/live.json', 'utf8')).list;
const RE = /^[A-Z]+[0-9]{3}$/;
const CAP = 500000, ADDON = 0.03, MAXM = 0.80;

// 相关系数（移仓调整序列的120日日收益）
const idxMap = {}; for (const c of Object.keys(A)) idxMap[c] = new Map(A[c].map(x => [x.d, x.i]));
const dates = [...new Set(Object.values(A).flatMap(s => s.map(x => x.d)))].sort().slice(-121);
function rets(c) { const o = []; for (let i = 1; i < dates.length; i++) { const a = idxMap[c].get(dates[i - 1]), b = idxMap[c].get(dates[i]); o.push(a && b ? Math.log(b / a) : 0); } return o; }
const R = {}; for (const c of Object.keys(A)) R[c] = rets(c);
function corr(a, b) {
  const x = R[a], y = R[b], n = Math.min(x.length, y.length);
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; }
  return sxy / Math.sqrt(sx * sy || 1);
}
function cov(a, b) { const x = R[a], y = R[b], n = Math.min(x.length, y.length); const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n; let s = 0; for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my); return s / (n - 1); }

console.log('=== 关键配对相关性（120日日收益，移仓调整序列）===');
const PAIRS = [['MA', 'FG'], ['MA', 'SA'], ['MA', 'TA'], ['MA', 'SH'], ['MA', 'CJ'], ['MA', 'AP'],
  ['FG', 'SA'], ['FG', 'SH'], ['SA', 'SH'], ['CJ', 'AP'], ['CJ', 'FG'], ['AP', 'SH'], ['MA', 'SR'], ['TA', 'FG']];
for (const [a, b] of PAIRS) console.log(`  ${a}-${b}  ${corr(a, b).toFixed(2)}`);

// 真实主力 & 可持有合约
function realMain(px) {
  const cs = L.filter(x => RE.test(x.dm) && x.dm.startsWith(px) && x.dm.length === px.length + 3 && x.p > 0 && x.ccl > 0);
  return cs.length ? cs.reduce((a, b) => b.ccl > a.ccl ? b : a) : null;
}
function holdableMain(px) {
  const cs = L.filter(x => RE.test(x.dm) && x.dm.startsWith(px) && x.dm.length === px.length + 3 && x.p > 0 && x.ccl > 0)
    .filter(x => { const ym = x.dm.slice(px.length); const y = +ym[0] + 2020, m = +ym.slice(1); return y > 2026 || (y === 2026 && m >= 12); });
  return cs.length ? cs.reduce((a, b) => b.ccl > a.ccl ? b : a) : null;
}
const SPEC = {}; for (const s of live) SPEC[s.symbol.replace(/0$/, '')] = s;

// 期限结构年化展期（来自 term.json）
const term = JSON.parse(fs.readFileSync('D:/ai tools/zce/out/term.json', 'utf8'));
const NC = { '丙烯':'PL','瓶片':'PR','甲醇':'MA','短纤':'PF','苹果':'AP','PTA':'TA','对二甲苯':'PX','菜油':'OI','棉纱':'CY','硅铁':'SF','菜籽':'RS','棉花':'CF','锰硅':'SM','菜粕':'RM','白糖':'SR','花生':'PK','尿素':'UR','玻璃':'FG','红枣':'CJ','纯碱':'SA','烧碱':'SH' };
const ANN = {}; for (const t of term) ANN[NC[t.cn]] = t.ann;

const BOOKS = [
  { name: '① 防守型：空建材三兄弟', legs: { FG: -1, SA: -1, SH: -0.6 }, tgt: 0.25 },
  { name: '② 均衡型：空建材 + 空农副', legs: { FG: -1, SA: -0.8, SH: -0.5, CJ: -0.7, AP: -0.5 }, tgt: 0.30 },
  { name: '③ 对冲型：多甲醇 + 空玻璃（双腿都吃正展期）', legs: { MA: 1, FG: -1 }, tgt: 0.30 },
  { name: '④ 对冲型：多甲醇/PTA + 空玻璃/纯碱/红枣', legs: { MA: 0.9, TA: 0.7, FG: -0.9, SA: -0.7, CJ: -0.5 }, tgt: 0.32 },
  { name: '⑤ 激进型：空建材+空农副（高杠杆）', legs: { FG: -1, SA: -1, SH: -0.6, CJ: -0.8, AP: -0.6 }, tgt: 0.60 },
  { name: '⑥ 单押：只空玻璃', legs: { FG: -1 }, tgt: 0.50 },
];

console.log('\n\n' + '='.repeat(118));
console.log('推荐组合评估（50万本金；仓位按目标波动率定，保证金上限80%）');
console.log('='.repeat(118));
console.log('组合                                        年化波动  保证金占用  展期收益贡献  1日95%VaR  1日99%VaR  手数');
console.log('-'.repeat(118));

const out = [];
for (const bk of BOOKS) {
  const cs = Object.keys(bk.legs);
  const wsum = cs.reduce((a, c) => a + Math.abs(bk.legs[c]), 0);
  const wn = {}; for (const c of cs) wn[c] = bk.legs[c] / wsum;
  let vs = 0; for (const a of cs) for (const b of cs) vs += wn[a] * wn[b] * cov(a, b);
  const unitVol = Math.sqrt(vs);
  let k = bk.tgt / (unitVol * Math.sqrt(244));
  const build = kk => cs.map(c => {
    const hm = holdableMain(c), sp = SPEC[c];
    const lots = Math.max(0, Math.round(kk * CAP * Math.abs(wn[c]) / (hm.p * sp.mult)));
    return { c, dir: bk.legs[c] > 0 ? '多' : '空', lots, hm: hm.dm, price: hm.p, mg: lots * hm.p * sp.mult * (sp.margin + ADDON), val: lots * hm.p * sp.mult, code: sp.code, ann: ANN[c], liq: hm.ccl };
  });
  let det = build(k), margin = det.reduce((a, d) => a + d.mg, 0);
  let scaled = false;
  while (margin > CAP * MAXM && k > 0.005) { k *= 0.85; det = build(k); margin = det.reduce((a, d) => a + d.mg, 0); scaled = true; }
  // 实际波动
  let vs2 = 0;
  for (const a of cs) for (const b of cs) {
    const ga = (bk.legs[a] > 0 ? 1 : -1) * det.find(d => d.c === a).val / CAP;
    const gb = (bk.legs[b] > 0 ? 1 : -1) * det.find(d => d.c === b).val / CAP;
    vs2 += ga * gb * cov(a, b);
  }
  const dv = Math.sqrt(vs2), av = dv * Math.sqrt(244);
  // 展期收益：多头赚 backwardation，空头赚 contango
  let carry = 0;
  for (const d of det) carry += (d.dir === '多' ? -d.ann : d.ann) / 100 * d.val;
  const lots = det.reduce((a, d) => a + d.lots, 0);
  console.log(bk.name.padEnd(44) + ((av * 100).toFixed(1) + '%').padStart(9) + ((margin / CAP * 100).toFixed(0) + '%').padStart(11) +
    (fmtNum(carry) + '/年').padStart(14) + fmtNum(dv * 1.645 * CAP).padStart(11) + fmtNum(dv * 2.326 * CAP).padStart(11) + String(lots).padStart(7));
  out.push({ ...bk, det, av, margin, marginPct: margin / CAP * 100, carry, lots, scaled });
}

console.log('\n\n=== 各组合下单明细 ===');
for (const bk of out) {
  console.log(`\n【${bk.name}】年化波动 ${(bk.av * 100).toFixed(1)}%  保证金 ${fmtNum(bk.margin)}(${bk.marginPct.toFixed(0)}%)  年化展期收益 ${fmtNum(bk.carry)}元${bk.scaled ? '  [已缩仓]' : ''}`);
  for (const d of bk.det) {
    console.log(`   ${d.dir} ${d.code.padEnd(6)} ${d.hm.padEnd(7)} ${String(d.lots).padStart(4)}手  价${String(d.price).padStart(7)}  合约价值${fmtNum(d.val).padStart(9)}  保证金${fmtNum(d.mg).padStart(8)}  持仓${fmtNum(d.liq).padStart(8)}  期限结构年化${d.ann >= 0 ? '+' : ''}${d.ann}%`);
  }
}
fs.writeFileSync('D:/ai tools/zce/out/books.json', JSON.stringify(out.map(b => ({ name: b.name, av: b.av, margin: b.margin, marginPct: b.marginPct, carry: b.carry, lots: b.lots, det: b.det })), null, 1), 'utf8');
console.log('\n[已保存 out/books.json]');
