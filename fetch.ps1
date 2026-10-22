$ErrorActionPreference = 'Continue'
$curl = "C:\Windows\System32\curl.exe"
$root = "D:\ai tools\zce"
$raw  = Join-Path $root "raw"
New-Item -ItemType Directory -Force -Path $raw | Out-Null

$symbols = @(
  @('SR','白糖'), @('CF','棉花'), @('CY','棉纱'), @('TA','PTA'), @('MA','甲醇'),
  @('OI','菜籽油'), @('RM','菜籽粕'), @('RS','菜籽'), @('FG','玻璃'), @('SA','纯碱'),
  @('AP','苹果'), @('CJ','红枣'), @('PK','花生'), @('UR','尿素'), @('SF','硅铁'),
  @('SM','锰硅'), @('SH','烧碱'), @('PX','对二甲苯'), @('PF','短纤'), @('PR','瓶片'),
  @('PL','丙烯'), @('ZC','动力煤'), @('WH','强麦'), @('PM','普麦'), @('RI','早籼稻'),
  @('JR','粳稻'), @('LR','晚籼稻')
)

$ok = @(); $fail = @()
foreach ($s in $symbols) {
  $code = $s[0]; $cn = $s[1]
  $sym = "${code}0"
  $url = "https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_${sym}=/InnerFuturesNewService.getDailyKLine?symbol=${sym}"
  $out = Join-Path $raw "$sym.js"
  & $curl -sS -m 45 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" -o $out $url 2>$null
  if ((Test-Path $out) -and ((Get-Item $out).Length -gt 500)) {
    $ok += "$sym=$cn($((Get-Item $out).Length))"
  } else {
    $fail += "$sym=$cn"
    Remove-Item $out -Force -ErrorAction SilentlyContinue
  }
}
Write-Output "=== OK ($($ok.Count)) ==="
$ok -join "  "
Write-Output ""
Write-Output "=== DEAD/FAIL ($($fail.Count)) ==="
$fail -join "  "
Write-Output ""

# 东财郑商所全合约实时快照
$snap = Join-Path $root "snapshot.json"
& $curl -sS -m 45 -A "Mozilla/5.0" -H "Referer: https://quote.eastmoney.com/" -o $snap "https://futsseapi.eastmoney.com/list/115?orderBy=zdf&sort=desc&pageSize=400&pageIndex=0&field=dm,sc,name,zxj,zdf,zde,rz,zsz,ccl,vol" 2>$null
if (Test-Path $snap) { Write-Output "snapshot bytes = $((Get-Item $snap).Length)" } else { Write-Output "snapshot FAILED" }
