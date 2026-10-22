"""每日决策简报：数据状态 + 风险预算 + 信号卡。

当前项目状态：未找到通过验证的信号，因此简报默认输出**观望卡**，
并如实说明原因。这不是占位符——它是本系统在现有证据下的正确输出。

用法：python scripts\\daily_brief.py [品种...]
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from zce import backtest as bt, config, risk, signal  # noqa: E402


def main() -> int:
    want = sys.argv[1:] or ["SR", "CF", "TA"]
    main_df = bt.load_main("live")
    last_date = main_df["date"].max()
    specs = bt.load_specs()

    lines = ["# 每日决策简报", "", f"- 数据截止：**{last_date.date()}**",
             f"- 账户初始权益：{config.CONTEST_INITIAL_EQUITY:,.0f} 元", ""]

    gate = risk.RiskGate()
    lines.append("## 风险预算")
    lines.append("")
    lines.append("| 项目 | 数值 |")
    lines.append("|---|---|")
    lines.append(f"| 单笔最大亏损 | {gate.equity * gate.cfg.max_risk_per_trade:,.0f} 元"
                 f"（{gate.cfg.max_risk_per_trade:.1%}） |")
    lines.append(f"| 单品种名义上限 | {gate.equity * gate.cfg.max_notional_per_symbol:,.0f} 元 |")
    lines.append(f"| 组合保证金上限 | {gate.equity * gate.cfg.max_total_margin:,.0f} 元 |")
    lines.append(f"| 回撤熔断线 | {gate.cfg.max_drawdown_halt:.0%} |")
    lines.append("")

    lines.append("## 主力合约快照")
    lines.append("")
    lines.append("| 品种 | 合约 | 收盘 | 持仓量 | 乘数 | 最小变动 |")
    lines.append("|---|---|---|---|---|---|")
    snap = main_df[main_df["date"] == last_date]
    for sym in want:
        row = snap[snap["symbol"] == sym]
        if row.empty:
            continue
        r = row.iloc[0]
        sp = specs.get(sym, {})
        lines.append(f"| {sym} | {r['contract']} | {r['close']:,.1f} | "
                     f"{r['open_interest']:,.0f} | {sp.get('mult')} | {sp.get('tick')} |")
    lines.append("")

    lines.append("## 今日信号")
    lines.append("")
    lines.append("**无可用信号。** 项目内已检验的三类假设（动量、低频动量、期限结构）"
                 "均未通过统计显著性与成本门槛，按纪律不生成开仓指令。")
    lines.append("")

    card = signal.watch_card(
        symbol=",".join(want), contract="不适用",
        reason="无通过验证的信号；任何开仓都将是无依据交易",
        details=[
            "动量信号：各回看期超额收益 t 值均 < 1.5",
            "期限结构：高 carry 组超额 t = 0.37，组合 Sharpe ≤ 0.24",
            "样本仅约 5.8 年、单一交易所，统计功效有限",
        ],
    )
    lines.append(card.render())
    lines.append("")

    out = config.REPORT_DIR / "daily_brief.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    print(f"\n[OK] 已写入 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
