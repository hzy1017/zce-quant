# run.ps1 - one-click launcher for the ZCE research project.
#
# Usage:
#   .\run.ps1 brief                 daily decision brief + signal card
#   .\run.ps1 test                  run all test suites (63 checks)
#   .\run.ps1 refresh               refresh quotes to the latest session
#   .\run.ps1 build [live]          rebuild cleaned dataset
#   .\run.ps1 backtest              baseline backtests
#   .\run.ps1 quality [live]        regenerate data quality report
#   .\run.ps1 doc                   regenerate the Word research report
#
# Interpreter resolution order:
#   1) $env:ZCE_PYTHON
#   2) ZCE_PYTHON=... in config.local (same file used by the Python code)
#   3) python on PATH
#   4) common install locations (only those that can import pandas/numpy)

param(
    [Parameter(Position = 0)][string]$Command = "help",
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest = @()
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# Make Chinese output readable in the console (Python prints UTF-8).
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $env:PYTHONIOENCODING = "utf-8"
} catch {
    # older hosts may not allow changing this; ignore
}

function Read-LocalConfig {
    $map = @{}
    $f = Join-Path $root "config.local"
    if (Test-Path $f) {
        Get-Content $f -Encoding UTF8 | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
                $i = $line.IndexOf("=")
                $map[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim().Trim('"').Trim("'")
            }
        }
    }
    return $map
}

function Test-Interp([string]$p) {
    if (-not $p -or -not (Test-Path $p)) { return $false }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $p -c "import pandas, numpy" *> $null
    $ok = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $prev
    return $ok
}

function Resolve-Python {
    $local = Read-LocalConfig
    $cands = New-Object System.Collections.ArrayList
    if ($env:ZCE_PYTHON) { [void]$cands.Add($env:ZCE_PYTHON) }
    if ($local.ContainsKey("ZCE_PYTHON")) { [void]$cands.Add($local["ZCE_PYTHON"]) }

    $onPath = Get-Command python -ErrorAction SilentlyContinue
    if ($onPath) { [void]$cands.Add($onPath.Source) }

    $patterns = @(
        (Join-Path $env:USERPROFILE ".dsh\dsh-runtimes\*\dependencies\python\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python3*\python.exe"),
        (Join-Path $env:USERPROFILE "anaconda3\python.exe"),
        (Join-Path $env:USERPROFILE "miniconda3\python.exe")
    )
    foreach ($pat in $patterns) {
        Get-ChildItem $pat -ErrorAction SilentlyContinue | ForEach-Object { [void]$cands.Add($_.FullName) }
    }

    foreach ($c in $cands) {
        if (Test-Interp $c) { return $c }
    }
    return $null
}

$py = Resolve-Python
if (-not $py) {
    Write-Host "[ERROR] No Python interpreter with pandas/numpy found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Install them into your Python, then retry:" -ForegroundColor Yellow
    Write-Host "    python -m pip install pandas numpy python-docx"
    Write-Host ""
    Write-Host "Or point the launcher at an existing interpreter (one of):" -ForegroundColor Yellow
    Write-Host '    $env:ZCE_PYTHON = "D:\path\to\python.exe"'
    Write-Host "    add  ZCE_PYTHON=D:\path\to\python.exe  to config.local"
    exit 1
}

Set-Location $root

switch ($Command.ToLower()) {
    "brief"    { & $py "scripts\daily_brief.py" @Rest }
    "refresh"  { & $py "scripts\refresh_data.py" @Rest }
    "build"    { & $py "scripts\build_dataset.py" @Rest }
    "quality"  { & $py "scripts\quality_report.py" @Rest }
    "backtest" { & $py "scripts\run_baselines.py" @Rest }
    "doc"      { & $py "scripts\build_report_docx.py" @Rest }
    "test" {
        $failed = 0
        foreach ($t in @("test_pipeline.py", "test_backtest.py", "test_risk.py")) {
            Write-Host "--- $t ---" -ForegroundColor Cyan
            & $py "tests\$t"
            if ($LASTEXITCODE -ne 0) { $failed++ }
        }
        if ($failed -gt 0) { Write-Host "$failed suite(s) failed" -ForegroundColor Red; exit 1 }
        Write-Host "all suites passed" -ForegroundColor Green
    }
    default {
        Write-Host "ZCE research project launcher" -ForegroundColor Cyan
        Write-Host "  python : $py"
        Write-Host ""
        Write-Host "  .\run.ps1 brief              daily brief + signal card"
        Write-Host "  .\run.ps1 test               run all tests"
        Write-Host "  .\run.ps1 refresh            refresh latest quotes"
        Write-Host "  .\run.ps1 build [live]       rebuild cleaned dataset"
        Write-Host "  .\run.ps1 backtest           baseline backtests"
        Write-Host "  .\run.ps1 quality [live]     data quality report"
        Write-Host "  .\run.ps1 doc                Word research report"
    }
}
