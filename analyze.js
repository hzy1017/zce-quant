/* 郑商所期货数据分析 + 折线图生成器 */
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/ai tools/zce';
const RAW = path.join(ROOT, 'raw');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });

// 郑商所合约规格（乘数=吨/手，tick=最小变动价位，margin=交易所保证金率估计）
const SPECS = {
  SR: { cn: '白糖',     mult: 10, tick: 1, margin: 0.09, sector: '软商品' },
  CF: { cn: '棉花',     mult: 5,  tick: 5, margin: 0.09, sector: '软商品' },
  CY: { cn: '棉纱',     mult: 5,  tick: 5, margin: 0.09, sector: '软商品' },
  TA: { cn: 'PTA',      mult: 5,  tick: 2, margin: 0.09, sector: '化工' },
  MA: { cn: '甲醇',     mult: 10, tick: 1, margin: 0.10, sector: '化工' },
  OI: { cn: '菜籽油',   mult: 10, tick: 1, margin: 0.10, sector: '油脂油料' },
  RM: { cn: '菜籽粕',   mult: 10, tick: 1, margin: 0.10, sector: '油脂油料' },
  RS: { cn: '菜籽',     mult: 10, tick: 1, margin: 0.20, sector: '油脂油料' },
  FG: { cn: '玻璃',     mult: 20, tick: 1, margin: 0.13, sector: '建材' },
  SA: { cn: '纯碱',     mult: 20, tick: 1, margin: 0.13, sector: '建材' },
  AP: { cn: '苹果',     mult: 10, tick: 1, margin: 0.14, sector: '农副' },
  CJ: { cn: '红枣',     mult: 5,  tick: 5, margin: 0.13, sector: '农副' },
  PK: { cn: '花生',     mult: 5,  tick: 2, margin: 0.10, sector: '油脂油料' },
  UR: { cn: '尿素',     mult: 20, tick: 1, margin: 0.10, sector: '化工' },
  SF: { cn: '硅铁',     mult: 5,  tick: 2, margin: 0.13, sector: '铁合金' },
  SM: { cn: '锰硅',     mult: 5,  tick: 2, margin: 0.13, sector: '铁合金' },
  SH: { cn: '烧碱',     mult: 30, tick: 1, margin: 0.13, sector: '化工' },
  PX: { cn: '对二甲苯', mult: 5,  tick: 2, margin: 0.11, sector: '化工' },
  PF: { cn: '短纤',     mult: 5,  tick: 2, margin: 0.10, sector: '化工' },
  PR: { cn: '瓶片',     mult: 15, tick: 1, margin: 0.10, sector: '化工' },
  PL: { cn: '丙烯',     mult: 5,  tick: 1, margin: 0.10, sector: '化工' },
  ZC: { cn: '动力煤',   mult: 100,tick: 0.2, margin: 0.50, sector: '能源(僵尸)' },
  WH: { cn: '强麦',     mult: 20, tick: 1, margin: 0.20, sector: '谷物(僵尸)' },
  PM: { cn: '普麦',     mult: 50, tick: 1, margin: 0.20, sector: '谷物(僵尸)' },
  RI: { cn: '早籼稻',   mult: 20, tick: 1, margin: 0.20, sector: '谷物(僵尸)' },
  JR: { cn: '粳稻',     mult: 20, tick: 1, margin: 0.20, sector: '谷物(僵尸)' },
  LR: { cn: '晚籼稻',   mult: 20, tick: 1, margin: 0.20, sector: '谷物(僵尸)' },
};

function parseSina(file) {
  const t = fs.readFileSync(file, 'latin1');
  const i = t.indexOf('['), j = t.lastIndexOf(']');
  if (i < 0 || j < 0) return [];
  return JSON.parse(t.slice(i, j + 1)).map(r => ({
    d: r.d, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v,
  })).filter(r => isFinite(r.c) && r.c > 0);
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const std = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

function stats(rows, spec) {
  const n = rows.length;
  const c = rows.map(r => r.c);
  const last = rows[n - 1], prev = rows[n - 2];
  const ret = k => n > k ? (last.c / c[n - 1 - k] - 1) * 100 : null;
  const lr = [];
  for (let i = Math.max(1, n - 61); i < n; i++) lr.push(Math.log(c[i] / c[i - 1]));
  const vol60 = std(lr) * Math.sqrt(244) * 100;
  const lr20 = [];
  for (let i = Math.max(1, n - 21); i < n; i++) lr20.push(Math.log(c[i] / c[i - 1]));
  const vol20 = lr20.length > 2 ? std(lr20) * Math.sqrt(244) * 100 : vol60;

  const w = c.slice(-250);
  let peak = w[0], mdd = 0;
  for (const x of w) { if (x > peak) peak = x; mdd = Math.min(mdd, (x / peak - 1) * 100); }
  const hi250 = Math.max(...w), lo250 = Math.min(...w);
  const pos250 = (last.c - lo250) / (hi250 - lo250) * 100;

  const ma = k => n >= k ? mean(c.slice(-k)) : null;
  const ma20 = ma(20), ma60 = ma(60), ma250 = ma(250);

  // ATR14 %
  let tr = [];
  for (let i = n - 14; i < n; i++) {
    tr.push(Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - rows[i - 1].c), Math.abs(rows[i].l - rows[i - 1].c)));
  }
  const atrPct = mean(tr) / last.c * 100;

  const val = last.c * spec.mult;              // 1手合约价值
  const mg  = val * spec.margin;               // 1手保证金(交易所)
  const lots = Math.floor(500000 / mg);        // 50万满仓可开手数

  return {
    code: spec.cn, symbol: rows.sym, sector: spec.sector,
    date: last.d, close: last.c, chg: (last.c / prev.c - 1) * 100,
    ret5: ret(5), ret20: ret(20), ret60: ret(60), ret120: ret(120), ret250: ret(250),
    vol20, vol60, mdd250: mdd, pos250, hi250, lo250,
    ma20, ma60, ma250, atrPct,
    aboveMA20: ma20 ? last.c > ma20 : null,
    aboveMA60: ma60 ? last.c > ma60 : null,
    aboveMA250: ma250 ? last.c > ma250 : null,
    mult: spec.mult, margin: spec.margin, val1: val, mg1: mg, lots,
    vol: last.v, adv20: mean(rows.slice(-20).map(r => r.v)),
    rows,
  };
}

// ---------- 加载 ----------
const all = [];
for (const f of fs.readdirSync(RAW)) {
  const m = /^([A-Z]+)0\.js$/.exec(f);
  if (!m) continue;
  const code = m[1], spec = SPECS[code];
  if (!spec) continue;
  const rows = parseSina(path.join(RAW, f));
  if (rows.length < 30) continue;
  rows.sym = code + '0';
  all.push(stats(rows, spec));
}
all.sort((a, b) => b.adv20 * b.val1 - a.adv20 * a.val1); // 按20日成交额排序

// 剔除僵尸品种（近20日几乎无成交）
const live = all.filter(s => s.adv20 > 2000);
const dead = all.filter(s => s.adv20 <= 2000);

// ---------- SVG 折线图 ----------
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.ceil(lo / step) * step;
  const t = [];
  for (let x = start; x <= hi + 1e-9; x += step) t.push(x);
  return t;
}

function fmt(v, dp) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return v.toFixed(dp);
}
function fmtNum(v) {
  if (!isFinite(v)) return '—';
  if (Math.abs(v) >= 100000000) return (v / 1e8).toFixed(2) + '亿';
  if (Math.abs(v) >= 10000) return (v / 1e4).toFixed(1) + '万';
  return String(Math.round(v));
}

function lineChart(s, opts = {}) {
  const W = opts.w || 560, H = opts.h || 210;
  const P = { l: 62, r: 14, t: 30, b: 30 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const N = opts.n || 180;
  const rows = s.rows.slice(-N);
  const cs = rows.map(r => r.c);
  const mas = opts.mas === false ? [] : [20, 60].map(k => {
    if (s.rows.length < k) return null;
    const src = s.rows.map(r => r.c);
    const out = [];
    for (let i = s.rows.length - rows.length; i < s.rows.length; i++) out.push(mean(src.slice(i - k + 1, i + 1)));
    return out;
  }).filter(Boolean);

  let lo = Math.min(...cs), hi = Math.max(...cs);
  for (const m of mas) { lo = Math.min(lo, ...m); hi = Math.max(hi, ...m); }
  const pad = (hi - lo) * 0.10 || hi * 0.02;
  lo -= pad; hi += pad;

  const X = i => P.l + (i / (rows.length - 1)) * iw;
  const Y = v => P.t + ih - ((v - lo) / (hi - lo)) * ih;

  const ticks = niceTicks(lo, hi, 4);
  let g = '';
  for (const t of ticks) {
    const y = Y(t);
    g += `<line x1="${P.l}" y1="${y.toFixed(1)}" x2="${W - P.r}" y2="${y.toFixed(1)}" stroke="#e8edf3" stroke-width="1"/>`;
    g += `<text x="${P.l - 7}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#8a94a6">${t >= 1000 ? Math.round(t) : t.toFixed(t < 10 ? 2 : 1)}</text>`;
  }
  // x 轴日期
  const xi = [0, Math.floor(rows.length / 3), Math.floor(2 * rows.length / 3), rows.length - 1];
  for (const i of xi) {
    g += `<text x="${X(i).toFixed(1)}" y="${H - P.b + 15}" text-anchor="middle" font-size="9.5" fill="#8a94a6">${rows[i].d.slice(5)}</text>`;
  }

  const maPath = mas.map((m, k) => {
    const col = k === 0 ? '#f59e0b' : '#8b5cf6';
    const dd = m.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    return `<path d="${dd}" fill="none" stroke="${col}" stroke-width="1.2" opacity="0.85"/>`;
  }).join('');

  const dd = cs.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const up = cs[cs.length - 1] >= cs[0];
  const col = up ? '#e11d48' : '#0f9d58';   // 中国习惯：红涨绿跌
  const area = `${dd}L${X(cs.length - 1).toFixed(1)},${(P.t + ih).toFixed(1)}L${P.l},${(P.t + ih).toFixed(1)}Z`;
  const gid = 'g_' + s.symbol;

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="${col}" stop-opacity="0.20"/><stop offset="100%" stop-color="${col}" stop-opacity="0.01"/>
</linearGradient></defs>
${g}
<path d="${area}" fill="url(#${gid})"/>
${maPath}
<path d="${dd}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round"/>
<text x="${P.l}" y="16" font-size="12.5" font-weight="600" fill="#1f2937">${s.code} ${s.symbol} <tspan font-weight="400" fill="#6b7280">${s.sector}</tspan></text>
<text x="${W - P.r}" y="16" text-anchor="end" font-size="12" font-weight="600" fill="${col}">${fmt(s.close, s.close >= 1000 ? 0 : 1)}  ${s.chg >= 0 ? '+' : ''}${fmt(s.chg, 2)}%</text>
<text x="${P.l}" y="${H - 4}" font-size="9.5" fill="#9aa4b2">${rows[0].d} → ${rows[rows.length - 1].d}　区间 ${fmt((cs[cs.length - 1] / cs[0] - 1) * 100, 1)}%　20日年化波动 ${fmt(s.vol20, 1)}%　250日最大回撤 ${fmt(s.mdd250, 1)}%</text>
</svg>`;
}

function multiChart(list, opts = {}) {
  const W = opts.w || 780, H = opts.h || 330;
  const P = { l: 52, r: 130, t: 26, b: 28 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const N = opts.n || 180;
  const series = list.map(s => {
    const r = s.rows.slice(-N);
    const base = r[0].c;
    return { s, r, norm: r.map(x => x.c / base * 100) };
  });
  const L = Math.min(...series.map(x => Math.min(...x.norm)));
  const Hh = Math.max(...series.map(x => Math.max(...x.norm)));
  const lo = Math.min(L, 100) - 2, hi = Math.max(Hh, 100) + 2;
  const X = i => P.l + (i / (N - 1)) * iw;
  const Y = v => P.t + ih - ((v - lo) / (hi - lo)) * ih;
  const COLORS = ['#2563eb', '#e11d48', '#f59e0b', '#0f9d58', '#8b5cf6', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5'];

  let g = '';
  for (const t of niceTicks(lo, hi, 5)) {
    const y = Y(t);
    const is100 = Math.abs(t - 100) < 1e-6;
    g += `<line x1="${P.l}" y1="${y.toFixed(1)}" x2="${W - P.r}" y2="${y.toFixed(1)}" stroke="${is100 ? '#c3cddb' : '#eef2f7'}" stroke-width="1" ${is100 ? 'stroke-dasharray="4 3"' : ''}/>`;
    g += `<text x="${P.l - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#8a94a6">${t.toFixed(0)}</text>`;
  }
  const paths = series.map((x, i) => {
    const c = COLORS[i % COLORS.length];
    const d = x.norm.map((v, j) => `${j ? 'L' : 'M'}${X(j).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    const pct = x.norm[x.norm.length - 1] - 100;
    return { d, c, x, pct };
  });
  let body = paths.map(p => `<path d="${p.d}" fill="none" stroke="${p.c}" stroke-width="1.9" stroke-linejoin="round" opacity="0.92"/>`).join('');
  let leg = paths.slice().sort((a, b) => b.pct - a.pct).map((p, i) =>
    `<g transform="translate(${W - P.r + 10},${P.t + 12 + i * 17})"><rect width="9" height="9" rx="2" fill="${p.c}"/><text x="14" y="8.5" font-size="10.5" fill="#374151">${p.x.s.code} ${p.pct >= 0 ? '+' : ''}${p.pct.toFixed(1)}%</text></g>`
  ).join('');
  const rows0 = series[0].r;
  const xi = [0, Math.floor(N / 2), N - 1];
  let xl = xi.map(i => `<text x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === N - 1 ? 'end' : 'middle'}" font-size="9.5" fill="#8a94a6">${rows0[Math.min(i, rows0.length - 1)].d}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" xmlns="http://www.w3.org/2000/svg">${g}${body}${leg}${xl}
<text x="${P.l}" y="15" font-size="11.5" fill="#6b7280">起点=100，区间相对涨跌幅（近${N}个交易日）</text></svg>`;
}

// ---------- 输出 CSV ----------
const COLS = ['symbol', 'code', 'sector', 'date', 'close', 'chg', 'ret5', 'ret20', 'ret60', 'ret120', 'ret250', 'vol20', 'vol60', 'mdd250', 'pos250', 'atrPct', 'mult', 'margin', 'val1', 'mg1', 'lots', 'adv20'];
const csv = [COLS.join(',')].concat(all.map(s => COLS.map(k => {
  const v = s[k];
  return typeof v === 'number' ? (Math.abs(v) >= 1000 ? Math.round(v) : v.toFixed(4)) : v;
}).join(','))).join('\n');
fs.writeFileSync(path.join(OUT, 'zce_stats.csv'), '\ufeff' + csv, 'utf8');

// ---------- 控制台摘要 ----------
const f = (v, d = 1) => v === null || !isFinite(v) ? '  —  ' : v.toFixed(d).padStart(6);
console.log('日期范围: ' + live[0].rows[0].d + ' → ' + live[0].date);
console.log('');
console.log('代码  品种      最新      日%    5日%   20日%   60日%  120日%  250日% 20日波动 最大回撤 250位置  ATR%   1手价值   1手保证金 50万手数  20日成交额');
console.log('-'.repeat(140));
for (const s of live) {
  console.log(
    s.symbol.padEnd(5) + s.code.padEnd(9) +
    String(s.close >= 1000 ? Math.round(s.close) : s.close.toFixed(1)).padStart(8) +
    f(s.chg, 2) + f(s.ret5) + f(s.ret20) + f(s.ret60) + f(s.ret120) + f(s.ret250) +
    f(s.vol20) + f(s.mdd250) + f(s.pos250, 0) + f(s.atrPct, 2) +
    fmtNum(s.val1).padStart(10) + fmtNum(s.mg1).padStart(11) + String(s.lots).padStart(9) +
    fmtNum(s.adv20 * s.val1).padStart(13)
  );
}
if (dead.length) {
  console.log('\n僵尸/无成交品种(近20日均量<2000手): ' + dead.map(s => s.symbol + s.code).join(', '));
}

// 存给 HTML 用
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({
  asof: live[0].date,
  live: live.map(s => { const o = { ...s }; delete o.rows; return o; }),
  dead: dead.map(s => ({ symbol: s.symbol, code: s.code, adv20: s.adv20 })),
}, null, 1), 'utf8');

module.exports = { all, live, dead, lineChart, multiChart, fmt, fmtNum, niceTicks, mean };
fs.writeFileSync(path.join(OUT, '_engine_ok'), 'ok');
console.log('\n[engine ready] live=' + live.length + ' dead=' + dead.length);
