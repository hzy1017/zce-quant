/* 最终信号合成：期限结构(展期收益) + 长周期动量 + 短周期反转 + 流动性约束 */
const fs = require('fs');
const E = require('./analyze.js');
const { live, fmtNum } = E;
const A = JSON.parse(fs.readFileSync('D:/ai tools/zce/out/adj_series.json', 'utf8'));
const term = JSON.parse(fs.readFileSync('D:/ai tools/zce/out/term.json', 'utf8'));
const L = JSON.parse(fs.readFileSync('D:/ai tools/zce/live.json', 'utf8')).list;
const RE = /^[A-Z]+[0-9]{3}$/;

const NAME2CODE = { 白糖:'SR',棉花:'CF',棉纱:'CY',PTA:'TA',甲醇:'MA',菜油:'OI',菜粕:'RM',菜籽:'RS',玻璃:'FG',
  纯碱:'SA',苹果:'AP',红枣:'CJ',花生:'PK',尿素:'UR',硅铁:'SF',锰硅:'SM',烧碱:'SH',对二甲苯:'PX',短纤:'PF',瓶片:'PR',丙烯:'PL' };

// 历史条件期望（未来40日，全部品种，来自 conditional.js）
function histExp(m60) {
  const p = m60 * 100;
  if (p > 20) return -3.32;
  if (p > 10) return 0.48;
  if (p > 5) return 0.79;
  if (p > 0) return -0.24;
  if (p > -5) return -0.14;
  if (p > -10) return 0.67;
  if (p > -20) return 0.47;
  return 5.97;
}
// 化工专属条件期望（未来40日）
function histExpChem(m60) {
  const p = m60 * 100;
  if (p > 20) return -6.77;
  if (p > 10) return 2.60;
  if (p > 0) return 1.66;
  if (p > -10) return 1.86;
  return 5.80;
}
const CHEMSET = ['MA', 'TA', 'PX', 'PF', 'PR', 'PL'];

// 可持有到 2026-12-04 的合约（交割月≥2027-01）及其流动性
function holdable(px) {
  const cs = L.filter(x => RE.test(x.dm) && x.dm.startsWith(px) && x.dm.length === px.length + 3 && x.p > 0 && x.ccl > 0)
    .map(x => ({ ...x, ym: x.dm.slice(px.length) }))
    .filter(x => (+x.ym[0] + 2020) > 2026 || ((+x.ym[0] + 2020) === 2026 && (+x.ym.slice(1)) >= 12));
  if (!cs.length) return null;
  return cs.reduce((a, b) => b.ccl > a.ccl ? b : a);
}

const rows = [];
for (const t of term) {
  const code = NAME2CODE[t.cn]; if (!code || !A[code]) continue;
  const s = A[code], n = s.length;
  const m20 = s[n - 1].i / s[n - 21].i - 1;
  const m60 = s[n - 1].i / s[n - 61].i - 1;
  const m250 = s[n - 1].i / s[n - 251].i - 1;
  const carry = -t.ann;                       // ann<0(backwardation) => carry>0 对多头有利
  const isChem = CHEMSET.includes(code);
  const exp = isChem ? histExpChem(m60) : histExp(m60);
  const hm = holdable(code);
  const liq = hm ? hm.ccl : 0;
  rows.push({ cn: t.cn, code, carry, m20, m60, m250, exp, hm: hm ? hm.dm : '—', liq, isChem, ann: t.ann });
}

// 标准化（z-score）后加权
function z(key, invert = false) {
  const v = rows.map(r => r[key]);
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1;
  rows.forEach(r => r['z_' + key] = (invert ? -(r[key] - m) : (r[key] - m)) / sd);
}
z('carry'); z('m250'); z('exp'); z('liq');

// 权重：展期收益 40%（最可靠），长周期动量 25%，短周期反转期望 25%，流动性 10%
for (const r of rows) r.score = 0.40 * r.z_carry + 0.25 * r.z_m250 + 0.25 * r.z_exp + 0.10 * r.z_liq;
rows.sort((a, b) => b.score - a.score);

console.log('='.repeat(126));
console.log('最终信号合成表（截至 2026-09-24 移仓调整序列 + 2026-09-28 期限结构）');
console.log('='.repeat(126));
console.log('品种        展期收益(年化,多头为正)  250日动量   60日动量  60日档位历史40日期望  可持有合约  该合约持仓  综合分');
console.log('-'.repeat(126));
for (const r of rows) {
  console.log(
    r.cn.padEnd(11) +
    ((r.carry >= 0 ? '+' : '') + r.carry.toFixed(1) + '%').padStart(18) +
    ((r.m250 >= 0 ? '+' : '') + (r.m250 * 100).toFixed(1) + '%').padStart(14) +
    ((r.m60 >= 0 ? '+' : '') + (r.m60 * 100).toFixed(1) + '%').padStart(12) +
    ((r.exp >= 0 ? '+' : '') + r.exp.toFixed(2) + '%').padStart(18) +
    r.hm.padStart(13) + fmtNum(r.liq).padStart(12) + r.score.toFixed(2).padStart(9)
  );
}

const longC = rows.filter(r => r.score > 0).slice(0, 8);
const shortC = rows.slice(-8).reverse();
console.log('\n\n综合分最高的做多候选：');
longC.forEach((r, i) => console.log(`  ${i + 1}. ${r.cn.padEnd(6)} ${r.hm.padEnd(8)} 综合${r.score.toFixed(2)}  展期${r.carry >= 0 ? '+' : ''}${r.carry.toFixed(1)}%  250日${(r.m250 * 100).toFixed(1)}%  60日${(r.m60 * 100).toFixed(1)}%`));
console.log('\n综合分最低的做空候选：');
shortC.forEach((r, i) => console.log(`  ${i + 1}. ${r.cn.padEnd(6)} ${r.hm.padEnd(8)} 综合${r.score.toFixed(2)}  展期${r.carry >= 0 ? '+' : ''}${r.carry.toFixed(1)}%  250日${(r.m250 * 100).toFixed(1)}%  60日${(r.m60 * 100).toFixed(1)}%`));

fs.writeFileSync('D:/ai tools/zce/out/synthesis.json', JSON.stringify(rows.map(r => ({
  cn: r.cn, code: r.code, carry: +r.carry.toFixed(2), m20: +(r.m20 * 100).toFixed(2), m60: +(r.m60 * 100).toFixed(2),
  m250: +(r.m250 * 100).toFixed(2), exp: r.exp, hm: r.hm, liq: r.liq, score: +r.score.toFixed(3), isChem: r.isChem,
})), null, 1), 'utf8');
console.log('\n[已保存 out/synthesis.json]');
