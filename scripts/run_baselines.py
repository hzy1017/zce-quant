"""基线策略回测：时序动量（TSMOM）与横截面动量（XS-MOM）。

方法：
- 样本内(IS)：2021-01-18 ~ 2024-12-31；样本外(OOS)：2025-01-01 ~ 2026-10-21。
- 参数按理论先验设定（60 日动量 / 20 日调仓），**不用 OOS 调参**。
- 另给出 IS 上的参数敏感性，仅用于说明稳健性，不参与选择。

用法：python scripts\\run_baselines.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from zce import backtest as bt, config  # noqa: E402

IS = ("2021-01-18", "2024-12-31")
OOS = ("2025-01-01", "2026-10-21")
OUT = config.DATA_DIR / "backtest"


def tsmom(panel: dict[str, pd.DataFrame], lookback: int = 60) -> pd.DataFrame:
    """时序动量：过去 L 日总收益为正做多、为负做空（换月收益已归零）。"""
    cols = {}
    for sym, df in panel.items():
        s = df.set_index("date")["idx"]
        cols[sym] = np.sign(s / s.shift(lookback) - 1).fillna(0).astype(int)
    return pd.DataFrame(cols).sort_index()


def benchmark(panel: dict[str, pd.DataFrame], every: int = 20) -> pd.DataFrame:
    """基准：全部品种等权做多，定期等权再平衡（衡量市场本身的方向）。"""
    dates = sorted(set().union(*[set(df["date"]) for df in panel.values()]))
    tgt = pd.DataFrame(1, index=pd.DatetimeIndex(dates), columns=sorted(panel))
    return tgt


def xs_mom(panel: dict[str, pd.DataFrame], lookback: int = 60,
           top: int = 3, rebal: int = 20) -> pd.DataFrame:
    prices = pd.DataFrame(
        {s: df.set_index("date")["idx"] for s, df in panel.items()}
    ).sort_index()
    ret = prices / prices.shift(lookback) - 1
    frames = []
    for i in range(0, len(ret), rebal):
        block = pd.DataFrame(0, index=ret.index[i:i + rebal], columns=ret.columns)
        row = ret.iloc[i].dropna()
        if len(row) >= top:
            block[row.nlargest(top).index] = 1
        frames.append(block)
    return pd.concat(frames).sort_index()


def evaluate(panel, specs, targets, window, name, n_slots: int = 5,
             weight_mode: str = "vol") -> dict:
    cfg = bt.BTConfig(start=window[0], end=window[1], n_slots=n_slots,
                      weight_mode=weight_mode)
    res = bt.run_backtest(panel, specs, targets, cfg)
    st = dict(res["stats"])
    st["strategy"] = name
    st["window"] = f"{window[0]}~{window[1]}"
    return {"stats": st, "equity": res["equity"], "trades": res["trades"]}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    main_df = bt.load_main("live")
    panel = bt.prepare(main_df)
    specs = bt.load_specs()

    runs = []
    specs_table = []

    # ---- 1) 主基线：IS / OOS ----
    plans = (
        ("TSMOM_60", tsmom, 5, "vol"),
        ("XS-MOM_60_top3", xs_mom, 3, "vol"),
        ("BENCH_LONG_ALL", benchmark, 20, "equal"),
    )
    for name, fn, slots, mode in plans:
        targets = fn(panel)
        for window, tag in ((IS, "IS"), (OOS, "OOS")):
            r = evaluate(panel, specs, targets, window, name,
                         n_slots=slots, weight_mode=mode)
            r["stats"]["sample"] = tag
            runs.append(r)

    # ---- 2) IS 参数敏感性（不用于选择）----
    for lb in (40, 60, 120):
        for window, tag in ((IS, "IS"),):
            r = evaluate(panel, specs, tsmom(panel, lookback=lb), window, f"TSMOM_{lb}")
            r["stats"]["sample"] = tag
            specs_table.append(r["stats"])

    # ---- 落盘 ----
    all_stats = [r["stats"] for r in runs] + specs_table
    stats_df = pd.DataFrame(all_stats)
    stats_df.to_csv(OUT / "stats.csv", index=False, encoding="utf-8")
    for r in runs:
        key = f"{r['stats']['strategy'].replace('-', '_')}_{r['stats']['sample']}"
        r["equity"].to_csv(OUT / f"equity_{key}.csv", index=False)
        if len(r["trades"]):
            r["trades"].to_csv(OUT / f"trades_{key}.csv", index=False)

    write_report(runs, specs_table, stats_df)
    print(stats_df[["strategy", "sample", "window", "total_return", "cagr",
                    "max_drawdown", "sharpe", "trades", "total_cost"]].to_string(index=False))
    return 0


def write_report(runs, sens, stats_df) -> None:
    L: list[str] = []
    A = L.append
    A("# 基线策略回测报告")
    A("")
    A("- 数据：`data/clean_live`（真实合约，截至 2026-10-21）")
    A("- 样本内 IS：2021-01-18 ~ 2024-12-31；样本外 OOS：2025-01-01 ~ 2026-10-21")
    A("- 成交：信号在 t 日收盘生成，**t+1 日开盘**成交；滑点 1 跳；手续费取终端逐合约参数（含 1.5 倍）")
    A("- 约束：整数手、保证金占用 ≤ 权益 80%、封板(H==L)与零成交不成交、换月计往返成本")
    A("")
    A("## 1. 主结果")
    A("")
    cols = ["strategy", "sample", "total_return", "cagr", "max_drawdown", "sharpe",
            "calmar", "trades", "win_rate", "profit_factor", "total_cost", "cost_ratio"]
    A("| 策略 | 样本 | 总收益 | 年化 | 最大回撤 | Sharpe | Calmar | 成交笔数 | 胜率 | 盈亏比 | 成本合计 | 成本/初始权益 |")
    A("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in runs:
        s = r["stats"]
        A("| {} | {} | {:.2%} | {:.2%} | {:.2%} | {} | {} | {} | {} | {} | {:.0f} | {:.2%} |".format(
            s["strategy"], s["sample"], s["total_return"], s["cagr"], s["max_drawdown"],
            s.get("sharpe"), s.get("calmar"), s.get("trades", 0), s.get("win_rate"),
            s.get("profit_factor"), s.get("total_cost", 0), s.get("cost_ratio", 0)))
    A("")
    A("## 2. 参数敏感性（仅 IS）")
    A("")
    A("| 配置 | 样本 | 总收益 | 年化 | 最大回撤 | Sharpe |")
    A("|---|---|---|---|---|---|")
    for s in sens:
        A("| {} | {} | {:.2%} | {:.2%} | {:.2%} | {} |".format(
            s["strategy"], s["sample"], s["total_return"], s["cagr"],
            s["max_drawdown"], s.get("sharpe")))
    A("")
    A("> 敏感性表只用于判断参数是否脆弱，**没有**据此在 OOS 上择优。")
    A("")
    A("## 3. 方法与局限")
    A("")
    A("1. 复权采用差额法消除换月跳空，换月另计一次往返手续费与滑点。")
    A("2. 日线数据无法判断盘中触发，止损/离场均在次日开盘执行，可能高估或低估滑点。")
    A("3. 保证金率使用终端逐合约月度值，若与开仓当日实际值不同，杠杆会有偏差。")
    A("4. 未计资金利息、未计交易所强平规则、未模拟部分成交。")
    A("5. 样本仅约 5.8 年且单一交易所（郑商所），结论的普适性有限。")
    A("")
    out = config.REPORT_DIR / "backtest_report.md"
    out.write_text("\n".join(L), encoding="utf-8")
    print(f"[OK] 报告写入 {out}")


if __name__ == "__main__":
    raise SystemExit(main())
