"""行情刷新：从 Sina 同源接口拉取最新日线。

设计：
1. **不覆盖** raw/ 与 contracts/（阶段一审计快照），写入 raw_live/ 与 contracts_live/。
2. 只刷新“还会变”的文件：27 个连续序列 + 未到期合约（month >= 2610），
   外加少量可能新挂牌的远月（失败则忽略）。
3. 每个文件校验：字节数、JSONP 可解析、最后交易日。
4. 输出 data/meta/refresh_manifest.json 记录来源、时间、结果，便于追溯。

用法：
    python scripts\\refresh_data.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from zce import config, jsdata  # noqa: E402

CURL = r"C:\Windows\System32\curl.exe"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
URL = ("https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_{sym}=/"
       "InnerFuturesNewService.getDailyKLine?symbol={sym}")

SYMBOLS = ["SR", "CF", "CY", "TA", "MA", "OI", "RM", "RS", "FG", "SA", "AP", "CJ",
           "PK", "UR", "SF", "SM", "SH", "PX", "PF", "PR", "PL", "ZC", "WH", "PM",
           "RI", "JR", "LR"]
# 可能新挂牌、快照里还没有的远月（拉不到就跳过）
EXTRA_MONTHS = ["2709", "2711", "2801"]


def fetch(sym: str, out: Path) -> dict:
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    proc = subprocess.run(
        [CURL, "-sS", "-L", "-m", "45", "-A", UA, "-o", str(tmp), URL.format(sym=sym)],
        capture_output=True, text=True,
    )
    rec = {"sym": sym, "ok": False, "bytes": 0, "last_date": None, "error": None}
    if proc.returncode != 0:
        rec["error"] = f"curl rc={proc.returncode}"
        tmp.unlink(missing_ok=True)
        return rec
    if not tmp.exists() or tmp.stat().st_size < 500:
        rec["error"] = "文件过小"
        tmp.unlink(missing_ok=True)
        return rec
    try:
        var, rows = jsdata.parse_jsonp_text(tmp.read_text(encoding="utf-8"))
        if not rows:
            raise ValueError("空数组")
        rec.update(ok=True, bytes=tmp.stat().st_size, last_date=rows[-1]["d"], var=var)
        tmp.replace(out)
    except Exception as exc:  # noqa: BLE001
        rec["error"] = f"解析失败: {exc}"
        tmp.unlink(missing_ok=True)
    return rec


def main() -> int:
    config.ensure_dirs()
    live_raw = ROOT / "raw_live"
    live_con = ROOT / "contracts_live"
    live_raw.mkdir(exist_ok=True)
    live_con.mkdir(exist_ok=True)

    jobs: list[tuple[str, Path]] = [(f"{s}0", live_raw / f"{s}0.js") for s in SYMBOLS]

    active = sorted(p.stem for p in (ROOT / "contracts").glob("*.js")
                    if (m := re.fullmatch(r"([A-Z]{1,2})(\d{4})", p.stem)) and m.group(2) >= "2610")
    jobs += [(c, live_con / f"{c}.js") for c in active]

    # 试探新挂牌远月
    for c in active:
        m = re.fullmatch(r"([A-Z]{1,2})(\d{4})", c)
        if m and m.group(2) >= "2705":
            for extra in EXTRA_MONTHS:
                jobs.append((f"{m.group(1)}{extra}", live_con / f"{m.group(1)}{extra}.js"))
    seen, uniq = set(), []
    for sym, out in jobs:
        if sym not in seen:
            seen.add(sym)
            uniq.append((sym, out))

    print(f"待刷新 {len(uniq)} 个文件（连续 27 + 合约 {len(uniq) - 27}）")
    results = []
    for i, (sym, out) in enumerate(uniq, 1):
        results.append(fetch(sym, out))
        if i % 25 == 0:
            print(f"  ... {i}/{len(uniq)}")
        time.sleep(0.15)

    ok = [r for r in results if r["ok"]]
    failed = [r for r in results if not r["ok"]]
    dates = [r["last_date"] for r in ok if r["last_date"]]
    manifest = {
        "refreshed_at": datetime.now().isoformat(timespec="seconds"),
        "source": "sina InnerFuturesNewService.getDailyKLine",
        "total": len(results),
        "ok": len(ok),
        "failed": len(failed),
        "latest_date": max(dates) if dates else None,
        "min_date": min(dates) if dates else None,
        "failures": failed,
        "files": [{k: r[k] for k in ("sym", "ok", "bytes", "last_date")} for r in results],
    }
    path = config.META_DIR / "refresh_manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n成功 {len(ok)} / {len(results)}，最新交易日 {manifest['latest_date']}")
    if failed:
        print("失败：")
        for r in failed[:15]:
            print(f"  {r['sym']}: {r['error']}")
    print(f"[OK] 清单写入 {path}")
    return 0 if len(ok) >= len(results) * 0.9 else 1


if __name__ == "__main__":
    raise SystemExit(main())
