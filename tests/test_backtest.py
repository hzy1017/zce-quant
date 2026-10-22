"""回测引擎验收测试。

覆盖：未来数据隔离、成本单调性、整数手与保证金约束、确定性。
运行：python tests\\test_backtest.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from zce import backtest as bt  # noqa: E402

PASS, FAIL = [], []


def check(name: str, cond: bool, detail: str = "") -> None:
    (PASS if cond else FAIL).append(name)
    print(("  PASS  " if cond else "  FAIL  ") + name + (f"  [{detail}]" if detail else ""))


def tsmom(panel, lookback=60):
    cols = {}
    for sym, df in panel.items():
        s = df.set_index("date")["idx"]
        cols[sym] = np.sign(s / s.shift(lookback) - 1).fillna(0).astype(int)
    return pd.DataFrame(cols).sort_index()


def main() -> int:
    print("=" * 78)
    print("回测引擎验收测试")
    print("=" * 78)

    panel = bt.prepare(bt.load_main("live"))
    specs = bt.load_specs()
    targets = tsmom(panel)

    # 1. 未来数据隔离
    print("\n[1] 未来数据隔离")
    T = pd.Timestamp("2025-06-30")
    sub = {s: df[df["date"] <= T].reset_index(drop=True) for s, df in panel.items()}
    t_sub = tsmom(sub)
    common = t_sub.index.intersection(targets.index)
    cols = [c for c in t_sub.columns if c in targets.columns]
    # 注意：NaN != NaN 恒为真，必须先填充再比较，否则会把“两边都缺失”误判为差异
    a = t_sub.loc[common, cols].fillna(-99)
    b = targets.loc[common, cols].fillna(-99)
    same = bool((a.values == b.values).all())
    check("截断后重算的历史信号与全样本一致", same, f"比较 {len(common)} 个交易日")

    # 2. 成本单调性
    print("\n[2] 成本敏感性")
    cfg0 = bt.BTConfig(start="2021-01-18", end="2026-10-21", slip_ticks=0.0, n_slots=5)
    cfg3 = bt.BTConfig(start="2021-01-18", end="2026-10-21", slip_ticks=3.0, n_slots=5)
    r0 = bt.run_backtest(panel, specs, targets, cfg0)
    r3 = bt.run_backtest(panel, specs, targets, cfg3)
    check("滑点越高最终权益越低",
          r0["stats"]["final_equity"] > r3["stats"]["final_equity"],
          f"{r0['stats']['final_equity']:.0f} vs {r3['stats']['final_equity']:.0f}")
    check("成本随滑点增加", r3["stats"]["total_cost"] > r0["stats"]["total_cost"])

    # 3. 交易约束
    print("\n[3] 交易约束")
    tr = r0["trades"]
    check("手数均为正整数", bool((tr.loc[tr["side"] != "换月", "lots"] > 0).all()))
    eq = r0["equity"]
    check("保证金占用不超过 80%", bool((eq["margin"] <= eq["equity"] * 0.80 + 1).all()),
          f"峰值 {r0['stats']['max_margin_pct']:.2%}")
    check("每日权益为正", bool((eq["equity"] > 0).all()))

    # 4. 确定性
    print("\n[4] 确定性")
    r0b = bt.run_backtest(panel, specs, targets, cfg0)
    check("两次运行结果一致",
          r0["stats"]["final_equity"] == r0b["stats"]["final_equity"])

    # 5. 指标自洽
    print("\n[5] 指标自洽")
    s = r0["stats"]
    check("总收益与期末权益一致",
          abs((s["final_equity"] / 500_000 - 1) - s["total_return"]) < 1e-4,
          f"{s['total_return']}")
    check("最大回撤为负", s["max_drawdown"] <= 0)

    print("\n" + "=" * 78)
    print(f"通过 {len(PASS)} 项，失败 {len(FAIL)} 项")
    print("=" * 78)
    return 0 if not FAIL else 1


if __name__ == "__main__":
    raise SystemExit(main())
