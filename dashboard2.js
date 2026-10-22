/* 主面板：把所有图表与统计合成一个自包含 HTML */
const fs = require('fs');
const E = require('./analyze.js');
const V = require('./viz2.js');
const { live, dead, lineChart, multiChart, fmt, fmtNum } = E;
const OUT = 'D:/ai tools/zce/out';
const asof = live[0].date;
const risk = JSON.parse(fs.readFileSync(OUT + '/risk.json', 'utf8'));
const term = JSON.parse(fs.readFileSync(OUT + '/term.json', 'utf8'));

const dp = v => v >= 1000 ? 0 : v >= 100 ? 1 : 2;
const sgn = v => (v >= 0 ? '+' : '') + fmt(v, 2);
const cls = v => v >= 0 ? 'up' : 'dn';

const SECTORS = {};
for (const s of live) (SECTORS[s.sector] = SECTORS[s.sector] || []).push(s);
const sectorCharts = Object.entries(SECTORS).map(([n, l]) =>
  `<div class="card"><h3>${n}</h3>${multiChart(l, { w: 700, h: 290, n: 180 })}</div>`).join('\n');
const grid = live.map(s => `<div class="card chart">${lineChart(s, { n: 180, w: 540, h: 205 })}</div>`).join('\n');

const HEAD = ['合约', '板块', '最新价', '日', '5日', '20日', '60日', '120日', '250日', '20日年化波动', '250日最大回撤', '区间位置', 'ATR%', '1手价值', '1手保证金', '满仓手数', '20日成交额'];
const statRows = live.map(s => `<tr>
<td class="sym"><b>${s.symbol}</b><span>${s.code}</span></td><td class="sec">${s.sector}</td>
<td class="num"><b>${fmt(s.close, dp(s.close))}</b></td>
${[s.chg, s.ret5, s.ret20, s.ret60, s.ret120, s.ret250].map(v => `<td class="num ${cls(v)}">${sgn(v)}%</td>`).join('')}
<td class="num">${fmt(s.vol20, 1)}%</td><td class="num dn">${fmt(s.mdd250, 1)}%</td><td class="num">${fmt(s.pos250, 0)}%</td>
<td class="num">${fmt(s.atrPct, 2)}%</td><td class="num">${fmtNum(s.val1)}</td><td class="num">${fmtNum(s.mg1)}</td>
<td class="num"><b>${s.lots}</b></td><td class="num">${fmtNum(s.adv20 * s.val1)}</td></tr>`).join('\n');

const riskRows = risk.rows.map(r => `<tr>
<td class="sym"><b>${r.symbol}</b><span>${r.code}</span></td><td>${r.mainDm}</td>
<td class="num">${fmt(r.price, dp(r.price))}</td><td class="num">${r.mult}</td>
<td class="num">${fmtNum(r.val)}</td><td class="num">${fmtNum(r.mg)}</td><td class="num"><b>${r.lotsFull}</b></td>
<td class="num">${(r.lotsFull * r.atrAmt / risk.cap * 100).toFixed(1)}%</td><td class="num">${fmtNum(r.atrAmt)}</td>
<td class="num ${cls(r.ret60)}">${sgn(r.ret60)}%</td><td class="num dn">${r.worst.toFixed(1)}%</td></tr>`).join('\n');

const portCards = risk.portfolios.map(p => `<div class="card">
<h3>${p.name}</h3>
<div class="sub" style="margin:0 0 8px">${p.note}</div>
<div class="kpis">
<div><span>年化波动</span><b>${(p.annVol * 100).toFixed(1)}%</b></div>
<div><span>保证金占用</span><b>${p.marginPct.toFixed(0)}%</b></div>
<div><span>1日95%VaR</span><b>${fmtNum(p.annVol / Math.sqrt(244) * 1.645 * risk.cap)}</b></div>
<div><span>手数合计</span><b>${p.lots}手</b></div>
</div>
<table style="margin-top:9px"><thead><tr><th>方向</th><th>品种</th><th>合约</th><th>手数</th><th>合约价值</th><th>保证金</th><th>1个ATR</th></tr></thead><tbody>
${p.det.map(d => `<tr><td class="${d.dir === '多' ? 'up' : 'dn'}"><b>${d.dir}</b></td><td>${d.code}</td><td>${d.mainDm}</td>
<td class="num"><b>${d.lots}</b></td><td class="num">${fmtNum(d.lots * (risk.rows.find(r => r.symbol === d.s)?.val || 0))}</td>
<td class="num">${fmtNum(d.mg)}</td><td class="num">±${fmtNum(d.atr)}</td></tr>`).join('')}
</tbody></table></div>`).join('\n');

const ladderRows = risk.ladder.map(l => `<tr><td class="num">${(l.tgt * 100).toFixed(0)}%</td>
<td class="num">${(l.gross * 100).toFixed(0)}%</td><td class="num ${l.marginPct > 80 ? 'dn' : ''}">${l.marginPct.toFixed(0)}%</td>
<td class="num">${l.lots.join(' / ')}</td><td class="num">${fmtNum(l.v95)}</td>
<td>${l.tgt >= 1 ? '<span class="dn">极高风险</span>' : l.tgt >= 0.5 ? '激进' : l.tgt >= 0.3 ? '进取' : '稳健'}</td></tr>`).join('\n');

const termRows = term.map(t => `<tr><td>${t.cn}</td><td>${t.near}</td><td>${t.main}</td><td class="num">${t.mainP}</td><td>${t.far}</td>
<td class="num ${t.roll < 0 ? 'up' : 'dn'}">${t.roll >= 0 ? '+' : ''}${t.roll}%</td>
<td class="num ${t.ann < 0 ? 'up' : 'dn'}"><b>${t.ann >= 0 ? '+' : ''}${t.ann}%</b></td>
<td>${t.ann < 0 ? '近高远低 · 做多有展期收益' : '近低远高 · 做空有展期收益'}</td></tr>`).join('\n');

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>郑商所期货全景分析 · ${asof}</title><style>
*{box-sizing:border-box}
body{margin:0;background:#f5f7fa;color:#1f2937;font:14px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:1280px;margin:0 auto;padding:26px 18px 80px}
h1{font-size:25px;margin:0 0 6px}
h2{font-size:19px;margin:40px 0 12px;padding-left:11px;border-left:4px solid #2563eb}
h3{font-size:14px;margin:0 0 8px;color:#374151;font-weight:600}
.sub{color:#6b7280;font-size:13px;margin-bottom:10px}
.card{background:#fff;border:1px solid #e5e9f0;border-radius:10px;padding:12px 14px;margin-bottom:14px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
.grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(540px,1fr));gap:14px}
.grid3{display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:14px}
.chart{padding:10px 12px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{padding:6px 7px;border-bottom:1px solid #eef2f7;text-align:left;white-space:nowrap}
th{background:#f8fafc;color:#475569;font-weight:600;font-size:12px}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.sym span{color:#9aa4b2;font-size:11px;margin-left:4px}
td.sec{color:#6b7280;font-size:12px}
.up{color:#e11d48}.dn{color:#0f9d58}
.tblwrap{overflow-x:auto;max-height:620px;overflow-y:auto;border:1px solid #e5e9f0;border-radius:10px;background:#fff}
.note{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 15px;font-size:13px;color:#78350f;margin:14px 0}
.note.blue{background:#eff6ff;border-color:#bfdbfe;color:#1e3a8a}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:11px}
.kpi{background:#fff;border:1px solid #e5e9f0;border-radius:9px;padding:11px 13px}
.kpi .l{font-size:11.5px;color:#8a94a6}.kpi .v{font-size:19px;font-weight:700;margin-top:2px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:4px}
.kpis>div{background:#f8fafc;border-radius:7px;padding:6px 9px}
.kpis span{display:block;font-size:11px;color:#8a94a6}.kpis b{font-size:15px}
.toc{background:#fff;border:1px solid #e5e9f0;border-radius:10px;padding:12px 16px;font-size:13px}
.toc a{color:#2563eb;text-decoration:none;margin-right:16px;display:inline-block}
</style></head><body><div class="wrap">
<h1>郑州商品交易所 · 期货全景分析</h1>
<div class="sub">数据截至 <b>${asof}</b>（收盘）+ <b>2026-09-28</b> 盘中快照　·　日线来源：新浪财经期货历史行情　·　共 ${live.length} 个活跃品种，${dead.length} 个已无成交（${dead.map(d => d.code).join('、')}）</div>
<div class="toc"><a href="#kpi">① 速览</a><a href="#sector">② 板块强弱</a><a href="#charts">③ 全品种折线图</a><a href="#term">④ 期限结构</a><a href="#corr">⑤ 相关性</a><a href="#stats">⑥ 统计总表</a><a href="#risk">⑦ 单手风险</a><a href="#port">⑧ 组合方案</a><a href="#ladder">⑨ 杠杆阶梯</a></div>

<h2 id="kpi">① 速览</h2>
<div class="g">
${live.slice().sort((a, b) => b.ret60 - a.ret60).slice(0, 3).map(s => `<div class="kpi"><div class="l">60日最强 · ${s.code}</div><div class="v up">${sgn(s.ret60)}%</div></div>`).join('')}
${live.slice().sort((a, b) => a.ret60 - b.ret60).slice(0, 3).map(s => `<div class="kpi"><div class="l">60日最弱 · ${s.code}</div><div class="v dn">${sgn(s.ret60)}%</div></div>`).join('')}
</div>
<div class="note blue"><b>一句话总结：</b>化工板块（丙烯/对二甲苯/瓶片/短纤/PTA/甲醇）是当前唯一的多头趋势板块，近60日涨 19%~35%，且期限结构呈<b>深度近高远低</b>（做多有正展期收益）；建材（纯碱/玻璃/烧碱）与农副（苹果/红枣）处于长期下跌趋势。但化工6品种彼此相关系数高达 <b>0.75~0.94</b> —— <b>同时买它们不等于分散，而是把同一个赌注加倍</b>。</div>

<h2 id="sector">② 板块相对强弱（归一化折线图）</h2>
<div class="sub">同板块内各品种以区间首日=100 归一化，直接比强弱。</div>
<div class="grid2">${sectorCharts}</div>

<h2 id="charts">③ 全品种价格折线图（近180交易日，含MA20/MA60）</h2>
<div class="sub">红涨绿跌（国内习惯）。灰线为区间最高/最低参考。每张图下方标注区间涨跌幅、20日年化波动、250日最大回撤。</div>
<div class="grid2">${grid}</div>

<h2 id="term">④ 期限结构（各交割月价格曲线）</h2>
<div class="note"><b>怎么用：</b>曲线<b style="color:#e11d48">向下倾斜</b>=现货紧张、近月贵，<b>做多有正展期收益</b>；曲线<b style="color:#0f9d58">向上倾斜</b>=现货过剩、远月贵，<b>做空有正展期收益</b>。曲线越陡，这笔"躺着的收益"越大。</div>
<div class="tblwrap" style="max-height:none"><table><thead><tr><th>品种</th><th>近月</th><th>主力(持仓最大)</th><th>主力价</th><th>远月</th><th>总价差</th><th>年化展期收益</th><th>含义</th></tr></thead><tbody>${termRows}</tbody></table></div>
<div class="grid3" style="margin-top:14px">${V.curves.map(c => `<div class="card">${c}</div>`).join('\n')}</div>

<h2 id="corr">⑤ 相关性矩阵</h2>
<div class="card" style="overflow-x:auto">${V.heatSvg}</div>

<h2 id="stats">⑥ 全品种统计总表</h2>
<div class="tblwrap"><table><thead><tr>${HEAD.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${statRows}</tbody></table></div>

<h2 id="risk">⑦ 各品种单手风险（50万本金）</h2>
<div class="sub">保证金 = 交易所标准 + 期货公司加收3%。"满仓时1个ATR=本金%"表示把50万全押上时，单日一个平均波幅的盈亏占本金比例。</div>
<div class="tblwrap" style="max-height:none"><table><thead><tr><th>品种</th><th>真实主力</th><th>最新价</th><th>乘数</th><th>1手价值</th><th>1手保证金</th><th>满仓手数</th><th>满仓时1ATR=本金%</th><th>1个ATR金额</th><th>60日涨幅</th><th>近250日最差单日</th></tr></thead><tbody>${riskRows}</tbody></table></div>

<h2 id="port">⑧ 候选组合方案（按目标波动率定仓，受保证金≤80%约束）</h2>
<div class="grid2">${portCards}</div>

<h2 id="ladder">⑨ 杠杆阶梯：同一持仓结构下波动率怎么选</h2>
<div class="sub">以"甲醇+PTA+对二甲苯各1/3"为例。注意保证金几乎不构成约束（郑商所保证金率仅10~14%），真正约束你的是波动率和爆仓风险。</div>
<div class="tblwrap" style="max-height:none"><table><thead><tr><th>目标年化波动</th><th>毛暴露</th><th>保证金占用</th><th>手数(MA/TA/PX)</th><th>1日95%VaR</th><th>风险等级</th></tr></thead><tbody>${ladderRows}</tbody></table></div>
<div class="note">⚠️ 波动率目标 ≥100% 意味着你的净值几天内就可能腰斩。<b>比赛里为了名次可以激进，但要知道这是在赌，不是在投资。</b></div>

<div class="sub" style="margin-top:40px;color:#9aa4b2">生成时间 ${new Date().toISOString().slice(0, 19).replace('T', ' ')}　·　本文件为数据整理与量化测算，不构成投资建议。期货为杠杆交易，可能损失全部本金。</div>
</div></body></html>`;

fs.writeFileSync(OUT + '/郑商所全景分析.html', html, 'utf8');
console.log('已生成 out/郑商所全景分析.html  (' + (html.length / 1024).toFixed(0) + ' KB)');
