/* 生成郑商所折线图 + HTML 统计面板 */
const fs = require('fs');
const path = require('path');
const E = require('./analyze.js');
const { live, dead, lineChart, multiChart, fmt, fmtNum } = E;

const OUT = 'D:/ai tools/zce/out';
const asof = live[0].date;
const dp = v => v >= 1000 ? 0 : v >= 100 ? 1 : 2;
const sgn = v => (v >= 0 ? '+' : '') + fmt(v, 2);
const cls = v => v >= 0 ? 'up' : 'dn';

// ===== 板块分组 =====
const SECTORS = {};
for (const s of live) (SECTORS[s.sector] = SECTORS[s.sector] || []).push(s);

// ===== 动量评分（用于排序候选）=====
for (const s of live) {
  // 趋势强度：60日动量 / 波动  + 均线多头排列
  const trend = (s.ret60 / (s.vol20 || 1));
  const ma = (s.aboveMA20 ? 1 : 0) + (s.aboveMA60 ? 1 : 0) + (s.aboveMA250 ? 1 : 0);
  s.momScore = trend * 10 + ma * 3;
  // 反弹位置：离250日低点越近越是"底部反弹"
  s.rebound = s.pos250;
}

const byMom = live.slice().sort((a, b) => b.momScore - a.momScore);
const byRet60 = live.slice().sort((a, b) => b.ret60 - a.ret60);
const byVol = live.slice().sort((a, b) => b.vol20 - a.vol20);

// ===== 各板块归一化对比图 =====
const sectorCharts = Object.entries(SECTORS).map(([name, list]) =>
  `<div class="card"><h3>${name} 板块对比</h3>${multiChart(list, { w: 700, h: 300, n: 180 })}</div>`
).join('\n');

// ===== 品种折线图网格 =====
const grid = live.map(s => `<div class="card chart">${lineChart(s, { n: 180, w: 540, h: 205 })}</div>`).join('\n');

// ===== 统计表 =====
const head = ['合约', '板块', '最新价', '日涨跌', '5日', '20日', '60日', '120日', '250日',
  '20日年化波动', '250日最大回撤', '250日区间位置', 'ATR%', '1手价值', '1手保证金', '50万可开手数', '20日成交额'];
const rowsHtml = live.map(s => `<tr>
<td class="sym"><b>${s.symbol}</b><span>${s.code}</span></td>
<td class="sec">${s.sector}</td>
<td class="num"><b>${fmt(s.close, dp(s.close))}</b></td>
<td class="num ${cls(s.chg)}">${sgn(s.chg)}%</td>
<td class="num ${cls(s.ret5)}">${sgn(s.ret5)}%</td>
<td class="num ${cls(s.ret20)}">${sgn(s.ret20)}%</td>
<td class="num ${cls(s.ret60)}">${sgn(s.ret60)}%</td>
<td class="num ${cls(s.ret120)}">${sgn(s.ret120)}%</td>
<td class="num ${cls(s.ret250)}">${sgn(s.ret250)}%</td>
<td class="num">${fmt(s.vol20, 1)}%</td>
<td class="num dn">${fmt(s.mdd250, 1)}%</td>
<td class="num">${fmt(s.pos250, 0)}%</td>
<td class="num">${fmt(s.atrPct, 2)}%</td>
<td class="num">${fmtNum(s.val1)}</td>
<td class="num">${fmtNum(s.mg1)}</td>
<td class="num"><b>${s.lots}</b></td>
<td class="num">${fmtNum(s.adv20 * s.val1)}</td>
</tr>`).join('\n');

// ===== 动量榜 =====
const momRows = byMom.map((s, i) => `<tr>
<td class="num">${i + 1}</td><td class="sym"><b>${s.symbol}</b><span>${s.code}</span></td>
<td class="num">${fmt(s.momScore, 1)}</td>
<td class="num ${cls(s.ret60)}">${sgn(s.ret60)}%</td>
<td class="num">${fmt(s.vol20, 1)}%</td>
<td class="num">${fmt(s.pos250, 0)}%</td>
<td>${s.aboveMA20 ? '✓' : '✗'} / ${s.aboveMA60 ? '✓' : '✗'} / ${s.aboveMA250 ? '✓' : '✗'}</td>
</tr>`).join('\n');

// ===== 50万下单能力 =====
const alloc = [
  { sym: 'MA0', name: '甲醇', r: '强势多头，60日+26%', lots: null },
  { sym: 'PX0', name: '对二甲苯', r: '强势多头，60日+28.5%', lots: null },
  { sym: 'PL0', name: '丙烯', r: '最强动量，60日+35.5%', lots: null },
  { sym: 'TA0', name: 'PTA', r: '多头，60日+19%', lots: null },
  { sym: 'PF0', name: '短纤', r: '多头，60日+22.4%', lots: null },
  { sym: 'SA0', name: '纯碱', r: '底部弱势，60日-9%', lots: null },
  { sym: 'FG0', name: '玻璃', r: '底部弱势，60日-5.4%', lots: null },
  { sym: 'AP0', name: '苹果', r: '最弱，250日-34%', lots: null },
  { sym: 'CJ0', name: '红枣', r: '最弱，250日-37%', lots: null },
  { sym: 'SR0', name: '白糖', r: '低波动，60日+2.6%', lots: null },
];
for (const a of alloc) { const s = live.find(x => x.symbol === a.sym); a.s = s; }

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>郑商所期货行情分析 · ${asof}</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f5f7fa;color:#1f2937;font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:26px 18px 70px}
h1{font-size:24px;margin:0 0 6px}
h2{font-size:18px;margin:38px 0 12px;padding-left:10px;border-left:4px solid #2563eb}
h3{font-size:14px;margin:0 0 8px;color:#374151;font-weight:600}
.sub{color:#6b7280;font-size:13px;margin-bottom:6px}
.card{background:#fff;border:1px solid #e5e9f0;border-radius:10px;padding:12px 14px;margin-bottom:14px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
.grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(540px,1fr));gap:14px}
.chart{padding:10px 12px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{padding:6px 7px;border-bottom:1px solid #eef2f7;text-align:left;white-space:nowrap}
th{background:#f8fafc;color:#475569;font-weight:600;position:sticky;top:0;font-size:12px}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.sym span{color:#9aa4b2;font-size:11px;margin-left:4px}
td.sec{color:#6b7280;font-size:12px}
.up{color:#e11d48}.dn{color:#0f9d58}
.tblwrap{overflow-x:auto;max-height:640px;overflow-y:auto;border:1px solid #e5e9f0;border-radius:10px;background:#fff}
.note{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 15px;font-size:13px;color:#78350f;margin:14px 0}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:11px}
.kpi{background:#fff;border:1px solid #e5e9f0;border-radius:9px;padding:11px 13px}
.kpi .l{font-size:11.5px;color:#8a94a6}.kpi .v{font-size:19px;font-weight:700;margin-top:2px}
</style></head><body><div class="wrap">
<h1>郑州商品交易所 · 期货价格折线图与统计</h1>
<div class="sub">数据截至 <b>${asof}</b>（收盘）　·　日线来源：新浪财经期货历史行情　·　共 ${live.length} 个活跃品种，${dead.length} 个品种已无成交（${dead.map(d => d.code).join('、')}）</div>
<div class="note"><b>红涨绿跌</b>（国内习惯）。折线图为主力连续合约近 180 个交易日收盘价；灰线为区间内最高/最低参考。所有保证金按交易所标准估算，实际以期货公司加收后为准。</div>

<h2>一、核心指标速览</h2>
<div class="g">
${byRet60.slice(0, 3).map(s => `<div class="kpi"><div class="l">60日最强 · ${s.code} ${s.symbol}</div><div class="v up">${sgn(s.ret60)}%</div></div>`).join('')}
${byRet60.slice(-3).reverse().map(s => `<div class="kpi"><div class="l">60日最弱 · ${s.code} ${s.symbol}</div><div class="v dn">${sgn(s.ret60)}%</div></div>`).join('')}
<div class="kpi"><div class="l">最高波动 · ${byVol[0].code}</div><div class="v">${fmt(byVol[0].vol20, 1)}%</div></div>
<div class="kpi"><div class="l">最低波动 · ${byVol[byVol.length - 1].code}</div><div class="v">${fmt(byVol[byVol.length - 1].vol20, 1)}%</div></div>
</div>

<h2>二、板块相对强弱（归一化折线图）</h2>
<div class="sub">同板块品种全部以区间首日 = 100 归一化，直接比较谁强谁弱。</div>
${sectorCharts}

<h2>三、全品种价格折线图（近180交易日，含MA20/MA60）</h2>
<div class="grid2">
${grid}
</div>

<h2>四、完整统计数据表</h2>
<div class="tblwrap"><table>
<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>${rowsHtml}</tbody></table></div>

<h2>五、动量综合排名（60日动量 ÷ 波动 + 均线排列）</h2>
<div class="tblwrap" style="max-height:none"><table>
<thead><tr><th>#</th><th>合约</th><th>动量分</th><th>60日涨幅</th><th>20日年化波动</th><th>250日位置</th><th>MA20/60/250 之上</th></tr></thead>
<tbody>${momRows}</tbody></table></div>

<div class="sub" style="margin-top:34px;color:#9aa4b2">生成时间 ${new Date().toISOString().slice(0, 19).replace('T', ' ')}　·　本文件仅为数据整理，不构成投资建议。</div>
</div></body></html>`;

fs.writeFileSync(path.join(OUT, 'zce_dashboard.html'), html, 'utf8');

// ===== 单独导出一张总览大图 SVG =====
const top8 = byRet60.slice(0, 8);
fs.writeFileSync(path.join(OUT, 'zce_top8.svg'),
  '<?xml version="1.0" encoding="UTF-8"?>\n' + multiChart(top8, { w: 900, h: 420, n: 180 }), 'utf8');

// 全部品种 sparkline 长图
const sparkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 ${live.length * 46 + 40}" width="1200">
<rect width="1200" height="${live.length * 46 + 40}" fill="#fff"/>
<text x="20" y="26" font-size="16" font-weight="700" fill="#1f2937">郑商所全品种 180 日走势速览 · ${asof}</text>`
  + live.map((s, i) => {
    const y0 = 44 + i * 46, rows = s.rows.slice(-180), cs = rows.map(r => r.c);
    const lo = Math.min(...cs), hi = Math.max(...cs);
    const X = j => 220 + (j / (cs.length - 1)) * 620;
    const Y = v => y0 + 32 - ((v - lo) / (hi - lo || 1)) * 30;
    const d = cs.map((v, j) => `${j ? 'L' : 'M'}${X(j).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    const up = cs[cs.length - 1] >= cs[0], col = up ? '#e11d48' : '#0f9d58';
    const pc = (cs[cs.length - 1] / cs[0] - 1) * 100;
    return `<line x1="20" y1="${y0 + 36}" x2="1180" y2="${y0 + 36}" stroke="#f1f5f9"/>
<text x="20" y="${y0 + 16}" font-size="13" font-weight="600" fill="#1f2937">${s.symbol}<tspan font-size="11.5" font-weight="400" fill="#9aa4b2" dx="7">${s.code}</tspan></text>
<text x="205" y="${y0 + 16}" font-size="12" font-weight="600" fill="${col}" text-anchor="end">${pc >= 0 ? '+' : ''}${pc.toFixed(1)}%</text>
<path d="${d}" fill="none" stroke="${col}" stroke-width="1.6"/>
<text x="880" y="${y0 + 16}" font-size="12" fill="#374151">${fmt(s.close, dp(s.close))}</text>
<text x="960" y="${y0 + 16}" font-size="11.5" fill="#6b7280">波动 ${fmt(s.vol20, 1)}%</text>
<text x="1060" y="${y0 + 16}" font-size="11.5" fill="#6b7280">回撤 ${fmt(s.mdd250, 1)}%</text>`;
  }).join('\n') + '</svg>';
fs.writeFileSync(path.join(OUT, 'zce_sparklines.svg'), sparkSvg, 'utf8');

console.log('已生成:');
console.log('  out/zce_dashboard.html   (完整面板: 图表+统计表)');
console.log('  out/zce_top8.svg         (60日最强8品种归一化对比)');
console.log('  out/zce_sparklines.svg   (全品种速览长图)');
console.log('  out/zce_stats.csv        (原始统计数据)');
console.log('');
console.log('== 60日动量榜 ==');
byMom.slice(0, 8).forEach((s, i) => console.log(` ${i + 1}. ${s.symbol} ${s.code}  动量分${fmt(s.momScore, 1)}  60日${sgn(s.ret60)}%  波动${fmt(s.vol20, 1)}%  位置${fmt(s.pos250, 0)}%`));
console.log('');
console.log('== 50万满仓保证金可开手数（按交易所保证金估算）==');
alloc.forEach(a => { if (a.s) console.log(` ${a.s.symbol} ${a.s.code.padEnd(5)} 1手保证金${fmtNum(a.s.mg1).padStart(7)}  满仓${String(a.s.lots).padStart(4)}手  合约价值${fmtNum(a.s.val1).padStart(7)}  ${a.r}`); });
