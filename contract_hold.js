/* 合约可持有性检查：比赛 2026-12-04 结束，郑商所"交割月前一交易日停止交易" */
const fs = require('fs');
const L = JSON.parse(fs.readFileSync('D:/ai tools/zce/live.json', 'utf8')).list;
const RE = /^[A-Z]+[0-9]{3}$/;

// 郑商所代码：1位年份 + 2位月份，如 701 = 2027年1月
function lastTradingMonth(ym) {
  const yy = +ym[0], mm = +ym.slice(1);
  const year = 2020 + yy;
  return { year, month: mm, stopBefore: `${year}-${String(mm).padStart(2, '0')}-01` };
}
function holdable(ym) {
  // 交割月前一交易日停牌 => 必须在交割月之前平掉
  const { year, month } = lastTradingMonth(ym);
  // 比赛 2026-12-04 结束
  const endY = 2026, endM = 12;
  // 可在比赛结束前一直持有 <=> 交割月 >= 2026-12 的下一个月
  return (year > endY) || (year === endY && month >= endM);
}

console.log('比赛结束日 2026-12-04。郑商所规则：合约在【交割月前一个交易日】停止交易。');
console.log('=> 交割月为 2026年11月 的合约约 10/30 就停牌，撑不到比赛结束；交割月为 2026年12月 的合约约 11/30 停牌，也撑不到 12/4。');
console.log('=> 只有【交割月 ≥ 2027年1月】的合约能一路持有到 12/4 收盘。\n');

const PREFIX = { 白糖:'SR',棉花:'CF',棉纱:'CY',PTA:'TA',甲醇:'MA',菜油:'OI',菜粕:'RM',玻璃:'FG',纯碱:'SA',
  苹果:'AP',红枣:'CJ',花生:'PK',尿素:'UR',硅铁:'SF',锰硅:'SM',烧碱:'SH',对二甲苯:'PX',短纤:'PF',瓶片:'PR',丙烯:'PL' };

console.log('品种        可持有到比赛结束的合约（按持仓量排序，只列持仓>3000手）');
console.log('-'.repeat(104));
for (const [cn, px] of Object.entries(PREFIX)) {
  const cs = L.filter(x => RE.test(x.dm) && x.dm.startsWith(px) && x.dm.length === px.length + 3 && x.p > 0 && x.ccl > 3000)
    .map(x => ({ ...x, ym: x.dm.slice(px.length) }))
    .filter(x => holdable(x.ym))
    .sort((a, b) => b.ccl - a.ccl);
  if (!cs.length) { console.log(cn.padEnd(11) + '（无满足条件的活跃合约）'); continue; }
  console.log(cn.padEnd(11) + cs.slice(0, 4).map(x => `${x.dm}=${x.p}(持仓${(x.ccl / 10000).toFixed(1)}万)`).join('   '));
}

console.log('\n当前主力若撑不到比赛结束的品种（必须提前换月）：');
console.log('-'.repeat(104));
for (const [cn, px] of Object.entries(PREFIX)) {
  const cs = L.filter(x => RE.test(x.dm) && x.dm.startsWith(px) && x.dm.length === px.length + 3 && x.p > 0 && x.ccl > 0);
  if (!cs.length) continue;
  const main = cs.reduce((a, b) => b.ccl > a.ccl ? b : a);
  const ym = main.dm.slice(px.length);
  if (!holdable(ym)) {
    const alt = cs.filter(x => holdable(x.dm.slice(px.length)) && x.ccl > 3000).sort((a, b) => b.ccl - a.ccl)[0];
    console.log(`${cn.padEnd(11)} 主力 ${main.dm}(持仓${(main.ccl / 10000).toFixed(1)}万) 撑不到12/4  ->  应换成 ${alt ? alt.dm + '(' + alt.p + ', 持仓' + (alt.ccl / 10000).toFixed(1) + '万)' : '无可替代合约'}`);
  }
}
