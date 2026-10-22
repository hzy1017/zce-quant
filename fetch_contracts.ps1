$ErrorActionPreference = 'Continue'
$curl = "C:\Windows\System32\curl.exe"
$root = "D:\ai tools\zce"
$raw  = Join-Path $root "contracts"
New-Item -ItemType Directory -Force -Path $raw | Out-Null

$codes = @('SR','CF','CY','TA','MA','OI','RM','FG','SA','AP','CJ','PK','UR','SF','SM','SH','PX','PF','PR','PL')
$years = @('22','23','24','25','26','27')
$months = @('01','03','05','07','09','10','11','12')

$ok = 0; $miss = 0
foreach ($c in $codes) {
  foreach ($y in $years) {
    foreach ($m in $months) {
      $sym = "$c$y$m"
      $out = Join-Path $raw "$sym.js"
      if ((Test-Path $out) -and ((Get-Item $out).Length -gt 2000)) { $ok++; continue }
      $url = "https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_${sym}=/InnerFuturesNewService.getDailyKLine?symbol=${sym}"
      & $curl -sS -m 25 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" -o $out $url 2>$null
      if ((Test-Path $out) -and ((Get-Item $out).Length -gt 2000)) { $ok++ }
      else { $miss++; Remove-Item $out -Force -ErrorAction SilentlyContinue }
    }
  }
  Write-Output "$c done  ok=$ok miss=$miss"
}
Write-Output "=== FINAL ok=$ok miss=$miss ==="
