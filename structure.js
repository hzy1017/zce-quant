/* 期限结构 + 相关性矩阵 */
const fs = require('fs');
const E = require('./analyze.js');
const { live } = E;

const L = JSON.parse(fs.readFileSync('D:/ai tools/zce/live.json', 'utf8')).list;
const asof = '2026-09-28 盘中';

const NAME2SYM = {};
for (const s of live) NAME2SYM[s.code] = s;

// 产品中文名 -> 代码前缀
const PREFIX = {
  '白糖': 'SR', '棉花': 'CF', '棉纱': 'CY', 'PTA': 'TA', '甲醇': 'MA', '菜油': 'OI',
  '菜粕': 'RM', '菜籽': 'RS', '玻璃': 'FG', '纯碱': 'SA', '苹果': 'AP', '红枣': 'CJ',
  '花生': 'PK', '尿素': 'UR', '硅铁': 'SF', '锰硅': 'SM', '烧碱': 'SH',
  '对二甲苯': 'PX', '短纤': 'PF', '瓶片': 'PR', '丙烯': 'PL',
};

const term = [];
for (const [cn, px] of Object.entries(PREFIX)) {
  const cs = L.filter(x => /^[A-Z]+\d{3}$/.test(x.dm) && x.dm.startsWith(px) && x.dm.length === px.length + 3 && x.p > 0)
    .map(x => ({ dm: x.dm, p: x.p, ccl: x.ccl, rz: x.rz, zdf: x.zdf, ym: x.dm.slice(px.length) }))
    .filter(x => x.ccl > 500)
    .sort((a, b) => {
      const ka = (+a.ym.slice(0, 1)) * 12 + (+a.ym.slice(1));   // 郑商所: 1位年 + 2位月
      const kb = (+b.ym.slice(0, 1)) * 12 + (+b.ym.slice(1));
      return ka - kb;
    });
  if (cs.length < 2) continue;
  const main = cs.slice().sort((a, b) => b.ccl - a.ccl)[0];
  const near = cs[0], far = cs[cs.length - 1];
  const nM = (+far.ym.slice(0, 1)) * 12 + (+far.ym.slice(1)) - ((+near.ym.slice(0, 1)) * 12 + (+near.ym.slice(1)));
  const roll = (far.p / near.p - 1) * 100;
  const ann = nM > 0 ? (Math.pow(far.p / near.p, 12 / nM) - 1) * 100 : null;
  term.push({ cn, px, cs, main, near, far, nM, roll, ann, spread: roll, steep: roll / (nM || 1) });
}
term.sort((a, b) => a.ann - b.ann);

console.log(`期限结构（${asof}）  按年化展期收益率排序（负=近高远低/backwardation，正=近低远高/contango）`);
console.log('品种      近月            主力            远月           月差  总价差   年化');
console.log('-'.repeat(104));
for (const t of term) {
  console.log(
    t.cn.padEnd(9) +
    `${t.near.dm}=${String(t.near.p).padStart(6)}`.padEnd(16) +
    `${t.main.dm}=${String(t.main.p).padStart(6)}(${String(Math.round(t.main.ccl / 1000))}k)`.padEnd(22) +
    `${t.far.dm}=${String(t.far.p).padStart(6)}`.padEnd(15) +
    String(t.nM).padStart(4) + '月' +
    (t.roll >= 0 ? '+' : '') + t.roll.toFixed(1).padStart(6) + '%' +
    (t.ann >= 0 ? '+' : '') + t.ann.toFixed(1).padStart(8) + '%'
  );
}

// ===== 相关性矩阵（120日日收益）=====
const list = live.filter(s => s.rows.length > 130);
const rets = {};
for (const s of list) {
  const r = s.rows.slice(-120).map(x => x.c);
  rets[s.symbol] = r.slice(1).map((v, i) => Math.log(v / r[i]));
}
const corr = (a, b) => {
  const A = rets[a], B = rets[b], n = Math.min(A.length, B.length);
  const ma = A.slice(-n).reduce((x, y) => x + y, 0) / n, mb = B.slice(-n).reduce((x, y) => x + y, 0) / n;
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    const da = A[A.length - n + i] - ma, db = B[B.length - n + i] - mb;
    sab += da * db; sa += da * da; sb += db * db;
  }
  return sab / Math.sqrt(sa * sb || 1);
};
const syms = list.map(s => s.symbol);
fs.writeFileSync('D:/ai tools/zce/out/corr.csv',
  '\ufeff' + [',' + syms.join(',')].concat(syms.map(a => a + ',' + syms.map(b => corr(a, b).toFixed(3)).join(','))).join('\n'), 'utf8');

// 高相关簇
console.log('\n\n高度相关对（120日收益相关系数 > 0.70）：');
const pairs = [];
for (let i = 0; i < syms.length; i++) for (let j = i + 1; j < syms.length; j++) {
  const c = corr(syms[i], syms[j]);
  if (c > 0.70) pairs.push([syms[i], syms[j], c]);
}
pairs.sort((a, b) => b[2] - a[2]);
for (const p of pairs.slice(0, 22)) console.log(`  ${p[0]} - ${p[1]}  ${p[2].toFixed(2)}`);
if (!pairs.length) console.log('  （无）');

// 低相关/负相关（分散化价值）
const lowp = [];
for (let i = 0; i < syms.length; i++) for (let j = i + 1; j < syms.length; j++) lowp.push([syms[i], syms[j], corr(syms[i], syms[j])]);
lowp.sort((a, b) => a[2] - b[2]);
console.log('\n最低相关对（分散化价值最高）：');
for (const p of lowp.slice(0, 10)) console.log(`  ${p[0]} - ${p[1]}  ${p[2].toFixed(2)}`);

fs.writeFileSync('D:/ai tools/zce/out/term.json', JSON.stringify(term.map(t => ({
  cn: t.cn, near: t.near.dm, main: t.main.dm, far: t.far.dm,
  mainP: t.main.p, roll: +t.roll.toFixed(2), ann: +t.ann.toFixed(1),
  curve: t.cs.map(c => `${c.dm}:${c.p}`),
})), null, 1), 'utf8');
