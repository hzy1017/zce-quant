/* 构建真实移仓调整连续序列（Panama-canal 法）
   核心：每日取"当日主力合约"自身的日收益，主力切换日不产生跳空 → 无移仓偏差 */
const fs = require('fs');
const path = require('path');
const RAW = 'D:/ai tools/zce/contracts';
const OUT = 'D:/ai tools/zce/out';

const CODES = ['SR','CF','CY','TA','MA','OI','RM','FG','SA','AP','CJ','PK','UR','SF','SM','SH','PX','PF','PR','PL'];
const META = {
  SR:'白糖',CF:'棉花',CY:'棉纱',TA:'PTA',MA:'甲醇',OI:'菜籽油',RM:'菜籽粕',FG:'玻璃',SA:'纯碱',
  AP:'苹果',CJ:'红枣',PK:'花生',UR:'尿素',SF:'硅铁',SM:'锰硅',SH:'烧碱',PX:'对二甲苯',PF:'短纤',PR:'瓶片',PL:'丙烯',
};

function parse(f) {
  const t = fs.readFileSync(f, 'latin1');
  const i = t.indexOf('['), j = t.lastIndexOf(']');
  if (i < 0 || j < 0) return null;
  try {
    return JSON.parse(t.slice(i, j + 1)).map(r => ({
      d: r.d, c: +r.c, v: +r.v, p: +r.p,
    })).filter(r => isFinite(r.c) && r.c > 0);
  } catch (e) { return null; }
}

// 读取全部合约
const perProduct = {};   // code -> { contract: Map(date -> {c,v,p}) }
const files = fs.readdirSync(RAW).filter(f => f.endsWith('.js'));
for (const f of files) {
  const m = /^([A-Z]+)(\d{2})(\d{2})\.js$/.exec(f);
  if (!m) continue;
  const [_, code, yy, mm] = m;
  if (!CODES.includes(code)) continue;
  const rows = parse(path.join(RAW, f));
  if (!rows || rows.length < 20) continue;
  (perProduct[code] = perProduct[code] || {})[yy + mm] = new Map(rows.map(r => [r.d, r]));
}

const result = {};
const report = [];
for (const code of CODES) {
  const cts = perProduct[code];
  if (!cts) { report.push(`${code} 无合约数据`); continue; }
  const months = Object.keys(cts).sort();

  // 每个合约自身的日收益（同一合约内相邻交易日）
  const ctRet = {};
  for (const k of months) {
    const ds = [...cts[k].keys()].sort();
    const r = new Map();
    for (let i = 1; i < ds.length; i++) {
      const a = cts[k].get(ds[i - 1]).c, b = cts[k].get(ds[i]).c;
      r.set(ds[i], Math.log(b / a));
    }
    ctRet[k] = r;
  }

  // 全部交易日
  const allDates = [...new Set(months.flatMap(k => [...cts[k].keys()]))].sort();
  // 每日选主力：持仓量最大（p），无p则用成交量
  const series = [];
  let curMain = null, cum = 0, switches = 0;
  for (const d of allDates) {
    const cands = months.filter(k => cts[k].has(d));
    if (!cands.length) continue;
    const score = k => { const x = cts[k].get(d); return (x.p > 0 ? x.p : x.v * 10); };
    const main = cands.reduce((a, b) => score(a) >= score(b) ? a : b);
    if (main !== curMain) { if (curMain !== null) switches++; curMain = main; }
    const r = ctRet[main].get(d);
    if (r === undefined || !isFinite(r)) continue;
    cum += r;
    series.push({ d, main, c: cts[main].get(d).c, idx: Math.exp(cum), r });
  }
  result[code] = series;
  const first = series[0], last = series[series.length - 1];
  report.push(`${code} ${META[code].padEnd(6)} ${series.length}日 ${first.d}→${last.d}  移仓${switches}次  指数 ${first.idx.toFixed(1)}→${last.idx.toFixed(2)}  累计${((last.idx / first.idx - 1) * 100).toFixed(1)}%`);
}

console.log('=== 移仓调整连续序列构建结果 ===');
report.forEach(r => console.log('  ' + r));

// 与"主连日线"对比：验证偏差有多大
console.log('\n=== 移仓调整 vs 新浪主连：区间涨跌幅对比 ===');
const E = require('./analyze.js');
console.log('品种    调整后区间%   主连区间%   差异     调整后60日%  主连60日%');
console.log('-'.repeat(78));
for (const code of CODES) {
  const s = result[code]; if (!s || s.length < 70) continue;
  const sym = code + '0';
  const live = E.live.find(x => x.symbol === sym);
  const adjTot = (s[s.length - 1].idx / s[0].idx - 1) * 100;
  const adj60 = (s[s.length - 1].idx / s[s.length - 61].idx - 1) * 100;
  if (!live) { console.log(`${code} 调整区间${adjTot.toFixed(1)}% 调整60日${adj60.toFixed(1)}%  (主连数据缺失)`); continue; }
  const n = Math.min(s.length, live.rows.length);
  const d0 = s[s.length - n].d;
  const lr = live.rows; const li = lr.findIndex(r => r.d === d0);
  const mainTot = li >= 0 ? (lr[lr.length - 1].c / lr[li].c - 1) * 100 : NaN;
  console.log(`${code.padEnd(7)}${adjTot.toFixed(1).padStart(10)}${mainTot.toFixed(1).padStart(12)}${(adjTot - mainTot).toFixed(1).padStart(9)}${adj60.toFixed(1).padStart(13)}${(live.ret60).toFixed(1).padStart(11)}`);
}

fs.writeFileSync(path.join(OUT, 'adj_series.json'), JSON.stringify(
  Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.map(x => ({ d: x.d, m: x.main, i: +x.idx.toFixed(4) }))]))
), 'utf8');
console.log('\n[已保存 out/adj_series.json]');
