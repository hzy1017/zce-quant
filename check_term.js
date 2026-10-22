const fs = require('fs');
const L = JSON.parse(fs.readFileSync('D:/ai tools/zce/live.json', 'utf8')).list;
const RE = /^[A-Z]+[0-9]{3}$/;
for (const px of ['SH', 'SA', 'PX', 'PF', 'PL', 'MA', 'TA', 'FG', 'CJ', 'AP']) {
  const cs = L.filter(x => RE.test(x.dm) && x.dm.startsWith(px) && x.dm.length === px.length + 3 && x.p > 0 && x.ccl > 300)
    .map(x => ({ ym: x.dm.slice(px.length), p: x.p, ccl: x.ccl, dm: x.dm }))
    .sort((a, b) => ((+a.ym[0]) * 12 + (+a.ym.slice(1))) - ((+b.ym[0]) * 12 + (+b.ym.slice(1))));
  if (cs.length < 2) { console.log(px + ' skip (n=' + cs.length + ')'); continue; }
  const slope = cs[cs.length - 1].p - cs[0].p;
  const nM = (+cs[cs.length - 1].ym[0]) * 12 + (+cs[cs.length - 1].ym.slice(1)) - ((+cs[0].ym[0]) * 12 + (+cs[0].ym.slice(1)));
  const ann = (Math.pow(cs[cs.length - 1].p / cs[0].p, 12 / nM) - 1) * 100;
  console.log(px.padEnd(4) + cs.map(c => c.dm + '=' + c.p).join('  '));
  console.log('     first=' + cs[0].dm + '(' + cs[0].p + ') last=' + cs[cs.length - 1].dm + '(' + cs[cs.length - 1].p + ') nM=' + nM +
    ' -> ' + (slope < 0 ? 'BACK' : 'CONTANGO') + ' ' + ann.toFixed(1) + '%');
  console.log('');
}
