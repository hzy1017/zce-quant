"""阶段三验收测试。

覆盖：解析、字段校验、时间顺序、缺失值、主数据一致性、重复运行幂等性。
运行：
    python tests\\test_pipeline.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from zce import build, clean, config, jsdata, master  # noqa: E402

PASS, FAIL = [], []


def check(name: str, cond: bool, detail: str = "") -> None:
    (PASS if cond else FAIL).append(f"{name} {detail}".strip())
    print(("  PASS  " if cond else "  FAIL  ") + name + (f"  [{detail}]" if detail else ""))


def main() -> int:
    print("=" * 78)
    print("阶段三验收测试")
    print("=" * 78)

    # 1. JSONP 解析
    print("\n[1] 解析能力")
    var, rows = jsdata.parse_jsonp_text(
        (config.RAW_DIR / "CF0.js").read_text(encoding="utf-8")
    )
    check("解析 CF0.js", var == "CF0" and len(rows) > 5000, f"var={var} rows={len(rows)}")

    df = jsdata.read_file(config.CONTRACT_DIR / "CF2201.js")
    check("字段完整", list(df.columns) == ["date", "open", "high", "low", "close",
                                          "settle", "volume", "open_interest"],
          str(list(df.columns)))
    check("日期已解析", pd.api.types.is_datetime64_any_dtype(df["date"]))
    check("价格已数值化", pd.api.types.is_numeric_dtype(df["close"]))

    # 2. 构建
    print("\n[2] 全量构建")
    q1 = build.run()
    check("单合约行数", q1["contracts"]["rows"] == 147082, str(q1["contracts"]["rows"]))
    check("连续序列条数", q1["continuous"]["rows"] > 0)
    check("交易日历覆盖", q1["calendar_days"] > 1000, f"{q1['calendar_days']} 天")
    check("OHLC 逻辑违规为 0", q1["contracts"]["ohlc_bad"] == 0,
          str(q1["contracts"]["ohlc_bad"]))
    check("非正价格为 0", q1["contracts"]["nonpos"] == 0)
    check("结算价为 0 已识别", q1["contracts"]["settle_zero"] == 133,
          str(q1["contracts"]["settle_zero"]))

    # 3. 落盘结果复核
    print("\n[3] 落盘数据校验")
    c = pd.read_csv(config.CLEAN_DIR / "contracts_clean.csv", parse_dates=["date"])
    check("无重复(合约,日期)", not c.duplicated(["contract", "date"]).any())
    per = c.groupby("contract")["date"].apply(lambda s: s.is_monotonic_increasing)
    check("各合约日期升序", bool(per.all()), f"{int(per.sum())}/{len(per)}")
    check("无可交易标记缺失", c["usable"].notna().all())
    check("清洗后结算价无 0", bool((c["settle"].fillna(1) > 0).all()))

    missing = c["close"].isna().sum()
    check("收盘价无缺失", missing == 0, f"缺失 {missing}")

    # 4. 合约主数据
    print("\n[4] 合约主数据一致性")
    f10 = master.load_f10()
    check("F10 郑商所期货条数", len(f10) == 27, str(len(f10)))
    check("乘数与最小变动均有效",
          f10[["tick", "multiplier"]].notna().all().all(),
          f"缺失={f10.loc[f10['multiplier'].isna(),'code'].tolist()}")
    conflicts = set(
        f10.loc[(f10["multiplier"] - f10["multiplier_dot"]).abs() > 1e-9, "code"]
    )
    check("乘数冲突仅限已知的 PF/PK",
          conflicts == {"PF", "PK"},
          f"实际冲突={sorted(conflicts)}；以 FUnit 为准（短纤/花生均为 5吨/手）")
    syms = set(c["symbol"].unique())
    check("全部交易品种均能匹配主数据", syms <= set(f10["code"]),
          f"未匹配={sorted(syms - set(f10['code']))}")

    sr = f10.set_index("code").loc["SR"]
    check("抽样核对 SR 乘数=10", sr["multiplier"] == 10.0, str(sr["multiplier"]))
    check("抽样核对 SR 最小变动=1", sr["tick"] == 1.0, str(sr["tick"]))
    check("抽样核对 SR 比赛手续费=4.5", abs(sr["fee_contest"] - 4.5) < 1e-9,
          str(sr["fee_contest"]))

    calc = master.load_calcparam()
    recon = master.reconcile_fees(f10, calc)
    counts = recon["status"].value_counts().to_dict()
    check("费率对账覆盖全部品种", len(recon) == 27, str(len(recon)))
    check("11 个品种终端计费 = F10×1.5", counts.get("match", 0) == 11, str(counts))
    check("差异品种已显式分类",
          {"constant_mismatch", "month_varying"} <= set(counts),
          f"不一致={sorted(recon.loc[recon['status']!='match','code'].tolist())}")

    # 5. 主力重建
    print("\n[5] 主力合约重建")
    main = pd.read_csv(config.CLEAN_DIR / "main_series.csv", parse_dates=["date"])
    check("主力序列非空", len(main) > 5000, f"{len(main)} 行")
    check("每品种每日唯一", not main.duplicated(["symbol", "date"]).any())
    rolls = pd.read_csv(config.CLEAN_DIR / "rolls.csv")
    check("换月事件已记录", len(rolls) > 0, f"{len(rolls)} 次")
    check("换月前后合约不同", bool((rolls["prev_contract"] != rolls["contract"]).all()))

    # 6. 幂等性
    print("\n[6] 重复运行幂等性")
    m1 = json.loads((config.META_DIR / "manifest.json").read_text(encoding="utf-8"))
    q2 = build.run()
    m2 = json.loads((config.META_DIR / "manifest.json").read_text(encoding="utf-8"))
    same = all(
        m1["outputs"][k]["sha256"] == m2["outputs"][k]["sha256"]
        for k in m1["outputs"]
        if k in m2["outputs"]
    )
    check("两次构建产物哈希一致", same)
    check("两次质量指标一致", q1["contracts"]["rows"] == q2["contracts"]["rows"])

    # 汇总
    print("\n" + "=" * 78)
    print(f"通过 {len(PASS)} 项，失败 {len(FAIL)} 项")
    if FAIL:
        print("失败项：")
        for f in FAIL:
            print("  -", f)
    print("=" * 78)
    return 0 if not FAIL else 1


if __name__ == "__main__":
    raise SystemExit(main())
