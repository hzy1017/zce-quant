/* 期限结构曲线图 + 相关性热力图 */
const fs = require('fs');
const E = require('./analyze.js');
const { live, fmt } = E;
const OUT = 'D:/ai tools/zce/out';

const L = JSON.parse(fs.readFileSync('D:/ai tools/zce/live.json', 'utf8')).list;
const PREFIX = { 白糖:'SR',棉花:'CF',棉纱:'CY',PTA:'TA',甲醇:'MA',菜油:'OI',菜粕:'RM',菜籽:'RS',
  玻璃:'FG',纯碱:'SA',苹果:'AP',红枣:'CJ',花生:'PK',尿素:'UR',硅铁:'SF',锰硅:'SM',
  烧碱:'SH',对二甲苯:'PX',短纤:'PF',瓶片:'PR',丙烯:'PL' };

// ========== 1. 期限结构曲线 ==========
function termCurve(cn, px) {
  const cs = L.filter(x => /^[A-Z]+\d{3}$/.test(x.dm) && x.dm.startsWith(px) && x.dm.length === px.length + 3 && x.p > 0 && x.ccl > 300)
    .map(x => ({ ym: x.dm.slice(px.length), p: x.p, ccl: x.ccl, dm: x.dm }))
    .sort((a, b) => ((+a.ym[0]) * 12 + (+a.ym.slice(1))) - ((+b.ym[0]) * 12 + (+b.ym.slice(1))));
  if (cs.length < 2) return null;
  const main = cs.slice().sort((a, b) => b.ccl - a.ccl)[0];

  const W = 380, H = 200, P = { l: 50, r: 14, t: 28, b: 30 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const ps = cs.map(c => c.p);
  let lo = Math.min(...ps), hi = Math.max(...ps);
  const pad = (hi - lo) * 0.12 || hi * 0.02; lo -= pad; hi += pad;
  const X = i => P.l + (cs.length === 1 ? iw / 2 : (i / (cs.length - 1)) * iw);
  const Y = v => P.t + ih - ((v - lo) / (hi - lo)) * ih;

  let g = '';
  const step = (hi - lo) / 3;
  for (let t = lo; t <= hi; t += step) {
    g += `<line x1="${P.l}" y1="${Y(t).toFixed(1)}" x2="${W - P.r}" y2="${Y(t).toFixed(1)}" stroke="#eef2f7"/>`;
    g += `<text x="${P.l - 6}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#8a94a6">${t >= 1000 ? Math.round(t) : t.toFixed(1)}</text>`;
  }
  const d = cs.map((c, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(c.p).toFixed(1)}`).join('');
  const slope = cs[cs.length - 1].p - cs[0].p;
  const col = slope < 0 ? '#e11d48' : '#0f9d58';   // 红=backwardation(近高远低), 绿=contango
  const pts = cs.map((c, i) => {
    const isMain = c.dm === main.dm;
    return `<circle cx="${X(i).toFixed(1)}" cy="${Y(c.p).toFixed(1)}" r="${isMain ? 4.2 : 2.8}" fill="${isMain ? '#2563eb' : col}" ${isMain ? 'stroke="#fff" stroke-width="1.5"' : ''}/>`;
  }).join('');
  const xl = cs.map((c, i) => (cs.length <= 8 || i % 2 === 0)
    ? `<text x="${X(i).toFixed(1)}" y="${H - P.b + 15}" text-anchor="middle" font-size="9" fill="#8a94a6">${c.ym}</text>` : '').join('');
  const nM = (+cs[cs.length - 1].ym[0]) * 12 + (+cs[cs.length - 1].ym.slice(1)) - ((+cs[0].ym[0]) * 12 + (+cs[0].ym.slice(1)));
  const ann = nM > 0 ? (Math.pow(cs[cs.length - 1].p / cs[0].p, 12 / nM) - 1) * 100 : 0;
  const tag = slope < 0 ? '近高远低 BACK' : '近低远高 CONTANGO';

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" xmlns="http://www.w3.org/2000/svg">
${g}<path d="${d}" fill="none" stroke="${col}" stroke-width="1.8"/>${pts}${xl}
<text x="${P.l}" y="15" font-size="12.5" font-weight="600" fill="#1f2937">${cn} <tspan font-size="11" font-weight="400" fill="#9aa4b2">${px}</tspan></text>
<text x="${W - P.r}" y="15" text-anchor="end" font-size="10.5" font-weight="600" fill="${col}">${tag} 年化${ann >= 0 ? '+' : ''}${ann.toFixed(1)}%</text>
<text x="${P.l}" y="${H - 3}" font-size="9.5" fill="#9aa4b2">各交割月价格（蓝点=持仓量最大主力合约，${main.dm}）</text>
</svg>`;
}

const curves = Object.entries(PREFIX).map(([cn, px]) => termCurve(cn, px)).filter(Boolean);
console.log('期限结构图: ' + curves.length + ' 张');

// ========== 2. 相关性热力图 ==========
const list = live.filter(s => s.rows.length > 130);
const rets = {};
for (const s of list) { const r = s.rows.slice(-120).map(x => x.c); rets[s.symbol] = r.slice(1).map((v, i) => Math.log(v / r[i])); }
function corr(a, b) {
  const A = rets[a], B = rets[b], n = Math.min(A.length, B.length);
  const ma = A.slice(-n).reduce((x, y) => x + y, 0) / n, mb = B.slice(-n).reduce((x, y) => x + y, 0) / n;
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const da = A[A.length - n + i] - ma, db = B[B.length - n + i] - mb; sab += da * db; sa += da * da; sb += db * db; }
  return sab / Math.sqrt(sa * sb || 1);
}
const syms = list.map(s => s.symbol);
const cell = 30, pad = 100, W = pad + syms.length * cell + 150, H = pad + syms.length * cell + 20;
function heatColor(c) {
  if (c >= 0) { const k = Math.min(1, c); return `rgb(${Math.round(255 - k * 200)},${Math.round(245 - k * 190)},${Math.round(250 - k * 130)})`; }
  const k = Math.min(1, -c); return `rgb(${Math.round(250 - k * 130)},${Math.round(250 - k * 60)},${Math.round(250 - k * 150)})`;
}
let hm = '';
for (let i = 0; i < syms.length; i++) {
  hm += `<text x="${pad - 6}" y="${pad + i * cell + 19}" text-anchor="end" font-size="10.5" fill="#374151">${syms[i]}</text>`;
  hm += `<text x="${pad + i * cell + cell / 2}" y="${pad - 6}" font-size="10.5" fill="#374151" transform="rotate(-60 ${pad + i * cell + cell / 2},${pad - 6})">${syms[i]}</text>`;
}
for (let i = 0; i < syms.length; i++) for (let j = 0; j < syms.length; j++) {
  const c = corr(syms[i], syms[j]);
  hm += `<rect x="${pad + j * cell}" y="${pad + i * cell}" width="${cell - 1}" height="${cell - 1}" rx="2" fill="${heatColor(c)}"/>`;
  if (i !== j && Math.abs(c) >= 0.7) hm += `<text x="${pad + j * cell + cell / 2}" y="${pad + i * cell + 19}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#fff">${c.toFixed(2).slice(1)}</text>`;
  else if (i === j) hm += `<text x="${pad + j * cell + cell / 2}" y="${pad + i * cell + 19}" text-anchor="middle" font-size="9" fill="#ffffff" opacity="0.55">1.0</text>`;
}
const heatSvg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" xmlns="http://www.w3.org/2000/svg">
<rect width="${W}" height="${H}" fill="#fff"/>
<text x="14" y="22" font-size="14" font-weight="700" fill="#1f2937">120日日收益率相关性矩阵</text>
<text x="14" y="40" font-size="11" fill="#6b7280">红=正相关(越深越强)　蓝绿=负相关　|r|≥0.70 的格子标注数值</text>
${hm}
<g transform="translate(${W - 132},${pad + 6})">
<text x="0" y="0" font-size="11" font-weight="600" fill="#374151">怎么读这张图</text>
<text x="0" y="18" font-size="10" fill="#6b7280">颜色越红 → 两个品种越</text>
<text x="0" y="32" font-size="10" fill="#6b7280">同涨同跌，一起买等于</text>
<text x="0" y="46" font-size="10" fill="#6b7280">加倍下同一个注。</text>
<text x="0" y="66" font-size="10" fill="#6b7280">化工6品种互相 0.75~0.94，</text>
<text x="0" y="80" font-size="10" fill="#6b7280">是一个赌注不是六个。</text>
<text x="0" y="100" font-size="10" fill="#6b7280">苹果/红枣 与化工负相关，</text>
<text x="0" y="114" font-size="10" fill="#6b7280">才是真正的分散化。</text>
</g></svg>`;
fs.writeFileSync(OUT + '/zce_termcurve.html',
  `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>郑商所期限结构</title>
<style>body{margin:0;background:#f5f7fa;font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2937}
.wrap{max-width:1240px;margin:0 auto;padding:24px 18px 60px}
h1{font-size:22px;margin:0 0 4px}.sub{color:#6b7280;font-size:13px;margin-bottom:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:13px}
.card{background:#fff;border:1px solid #e5e9f0;border-radius:10px;padding:10px 12px}
.note{background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 15px;font-size:13px;color:#1e3a8a;margin:16px 0}
</style></head><body><div class="wrap">
<h1>郑商所各品种期限结构（各交割月价格曲线）</h1>
<div class="sub">数据时点 2026-09-28 盘中　·　横轴=交割月，纵轴=价格，蓝点=持仓量最大的主力合约</div>
<div class="note"><b>怎么用：</b>曲线<b style="color:#e11d48">向下倾斜（近高远低 / backwardation）</b>说明现货紧张、近月抢手，<b>做多有正的展期收益</b>；曲线<b style="color:#0f9d58">向上倾斜（近低远高 / contango）</b>说明现货过剩、远月升水，<b>做空有正的展期收益</b>。曲线越陡，展期收益越大。</div>
<div class="grid">${curves.map(c => `<div class="card">${c}</div>`).join('\n')}</div>
<h1 style="margin-top:34px">相关性矩阵</h1>
<div class="card" style="overflow-x:auto">${heatSvg}</div>
</div></body></html>`, 'utf8');

fs.writeFileSync(OUT + '/zce_heatmap.svg', '<?xml version="1.0" encoding="UTF-8"?>\n' + heatSvg, 'utf8');
console.log('已生成 out/zce_termcurve.html 和 out/zce_heatmap.svg');

module.exports = { termCurve, curves, heatSvg, PREFIX, corr, syms };
