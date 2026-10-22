/* 条件期望：过去N日大涨/大跌之后，未来M日的平均表现（动量 vs 均值回归） */
const fs = require('fs');
const A = JSON.parse(fs.readFileSync('D:/ai tools/zce/out/adj_series.json', 'utf8'));
const codes = Object.keys(A);

function fwd(s, i, m) { return i + m < s.length ? s[i + m].i / s[i].i - 1 : null; }
function back(s, i, n) { return i - n >= 0 ? s[i].i / s[i - n].i - 1 : null; }

for (const N of [20, 60, 120]) {
  for (const M of [20, 40]) {
    console.log(`\n【过去${N}日涨幅分档 → 未来${M}日平均收益】（全部品种合并，${codes.length}个品种，2021-2026）`);
    const buckets = [
      ['< -20%', -9, -0.20], ['-20~-10%', -0.20, -0.10], ['-10~-5%', -0.10, -0.05],
      ['-5~0%', -0.05, 0], ['0~+5%', 0, 0.05], ['+5~+10%', 0.05, 0.10],
      ['+10~+20%', 0.10, 0.20], ['> +20%', 0.20, 9],
    ];
    console.log('过去涨幅档      样本数   未来' + M + '日平均   中位数    胜率    未来' + M + '日波动');
    console.log('-'.repeat(78));
    for (const [label, lo, hi] of buckets) {
      const res = [];
      for (const c of codes) {
        const s = A[c];
        for (let i = N; i < s.length; i++) {
          const b = back(s, i, N);
          if (b === null || b <= lo || b > hi) continue;
          const f = fwd(s, i, M);
          if (f !== null) res.push(f);
        }
      }
      if (res.length < 20) { console.log(label.padEnd(16) + String(res.length).padStart(6) + '   样本太少'); continue; }
      const m = res.reduce((a, b) => a + b, 0) / res.length;
      const sorted = [...res].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      const win = res.filter(x => x > 0).length / res.length * 100;
      const sd = Math.sqrt(res.reduce((a, b) => a + (b - m) ** 2, 0) / (res.length - 1));
      console.log(label.padEnd(16) + String(res.length).padStart(6) +
        ((m * 100).toFixed(2) + '%').padStart(12) + ((med * 100).toFixed(2) + '%').padStart(10) +
        (win.toFixed(1) + '%').padStart(8) + ((sd * 100).toFixed(1) + '%').padStart(13));
    }
  }
}

// 只看化工6品种
console.log('\n\n=== 只看化工6品种（MA/TA/PX/PF/PR/PL）===');
const chem = ['MA', 'TA', 'PX', 'PF', 'PR', 'PL'].filter(c => A[c]);
for (const N of [60]) for (const M of [20, 40]) {
  console.log(`\n过去${N}日涨幅 → 未来${M}日平均收益`);
  const buckets = [['< -10%', -9, -0.10], ['-10~0%', -0.10, 0], ['0~+10%', 0, 0.10], ['+10~+20%', 0.10, 0.20], ['> +20%', 0.20, 9]];
  for (const [label, lo, hi] of buckets) {
    const res = [];
    for (const c of chem) {
      const s = A[c];
      for (let i = N; i < s.length; i++) {
        const b = back(s, i, N);
        if (b === null || b <= lo || b > hi) continue;
        const f = fwd(s, i, M);
        if (f !== null) res.push(f);
      }
    }
    if (res.length < 10) { console.log('  ' + label.padEnd(12) + '样本太少(' + res.length + ')'); continue; }
    const m = res.reduce((a, b) => a + b, 0) / res.length;
    const win = res.filter(x => x > 0).length / res.length * 100;
    console.log('  ' + label.padEnd(12) + `n=${String(res.length).padStart(4)}  未来${M}日平均 ${(m * 100).toFixed(2)}%   胜率 ${win.toFixed(1)}%`);
  }
}

// 当前所处的档位
console.log('\n\n=== 各品种当前所处档位（截至 2026-09-24，移仓调整序列）===');
console.log('品种   过去20日   过去60日   过去120日');
for (const c of codes) {
  const s = A[c];
  const b = n => ((s[s.length - 1].i / s[s.length - 1 - n].i - 1) * 100).toFixed(1) + '%';
  console.log(c.padEnd(7) + b(20).padStart(9) + b(60).padStart(11) + b(120).padStart(11));
}
