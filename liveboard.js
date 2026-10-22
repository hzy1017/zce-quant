/* 今日实时盘面（用真实主力合约，修正东财"主连"标错的问题） */
const fs = require('fs');
const E = require('./analyze.js');
const { live, fmtNum, fmt } = E;
const L = JSON.parse(fs.readFileSync('D:/ai tools/zce/live.json', 'utf8')).list;
const RE = /^[A-Z]+[0-9]{3}$/;

console.log('郑商所今日盘面（2026-09-28 盘中）— 主力=持仓量最大合约');
console.log('='.repeat(112));
console.log('品种       主力合约   最新价    今日%    5日%   20日%   持仓量    日增仓    成交量   成交额(亿)');
console.log('-'.repeat(112));

const rows = [];
for (const s of live) {
  const px = s.symbol.replace(/0$/, '');
  const cs = L.filter(x => RE.test(x.dm) && x.dm.startsWith(px) && x.dm.length === px.length + 3 && x.p > 0 && x.ccl > 0);
  if (!cs.length) continue;
  const m = cs.reduce((a, b) => b.ccl > a.ccl ? b : a);
  rows.push({ s, m });
}
rows.sort((a, b) => (b.m.vol * b.m.p * b.s.mult) - (a.m.vol * a.m.p * a.s.mult));
for (const { s, m } of rows) {
  console.log(
    s.code.padEnd(11) + m.dm.padEnd(11) +
    String(m.p >= 1000 ? Math.round(m.p) : m.p.toFixed(1)).padStart(8) +
    ((m.zdf >= 0 ? '+' : '') + m.zdf.toFixed(2) + '%').padStart(9) +
    ((m.zdf5 >= 0 ? '+' : '') + m.zdf5.toFixed(2) + '%').padStart(8) +
    ((m.zdf20 >= 0 ? '+' : '') + m.zdf20.toFixed(2) + '%').padStart(8) +
    fmtNum(m.ccl).padStart(10) + ((m.rz >= 0 ? '+' : '') + fmtNum(m.rz)).padStart(9) +
    fmtNum(m.vol).padStart(10) + (m.vol * m.p * s.mult / 1e8).toFixed(1).padStart(11)
  );
}
console.log('\n注：东财"主连"(MAM/M)标记的甲醇主力是MA611(持仓50.6万)，但MA701持仓69.5万才是真主力——东财标错，本表已修正。');
