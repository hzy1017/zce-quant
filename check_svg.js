const fs = require('fs');
const h = fs.readFileSync('D:/ai tools/zce/out/zce_termcurve.html', 'utf8');
// 每个面板：抓标题里的品种名 + 右上角标签 + 年化
const re = /font-weight="600" fill="#1f2937">([^<]+) <tspan[^>]*>([A-Z]+)<\/tspan>[\s\S]*?fill="#(e11d48|0f9d58)">([^<]+)<\/text>/g;
let m, n = 0;
const seen = [];
while ((m = re.exec(h))) {
  n++;
  seen.push(`${m[2].padEnd(4)} ${m[1].padEnd(6)} ${m[4].replace(/\s+/g, ' ')}`);
}
console.log('面板数 = ' + n);
seen.forEach(s => console.log('  ' + s));
