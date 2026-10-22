"""风险审核层与信号卡验收测试。

运行：python tests\\test_risk.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from zce import risk, signal  # noqa: E402

PASS, FAIL = [], []


def check(name: str, cond: bool, detail: str = "") -> None:
    (PASS if cond else FAIL).append(name)
    print(("  PASS  " if cond else "  FAIL  ") + name + (f"  [{detail}]" if detail else ""))


def base_order(**kw) -> risk.Order:
    """SR 主力：价格 5389，止损 5289（100 点），乘数 10，保证金 10%。"""
    p = dict(symbol="SR", contract="SR2701", direction=1, lots=2, price=5389.0,
             stop_price=5289.0, mult=10.0, tick=1.0, margin_rate=0.10,
             volume=300_000, open_interest=500_000, fee_per_lot=4.5, slip_ticks=1.0)
    p.update(kw)
    return risk.Order(**p)


def main() -> int:
    print("=" * 78)
    print("风险审核层测试")
    print("=" * 78)

    # 1. 正常订单通过
    print("\n[1] 合规订单")
    gate = risk.RiskGate()
    d = gate.evaluate(base_order())
    check("正常订单通过", d.approved, d.summary())
    check("单笔风险计算正确", d.metrics["risk_total"] == 2000.0, str(d.metrics["risk_total"]))

    # 2. 单笔风险超限
    print("\n[2] 单笔风险上限")
    d = gate.evaluate(base_order(lots=10))       # 风险 10,000 元 > 2,500 上限
    check("超风险订单被拒", not d.approved, d.summary())
    check("拒绝理由提及单笔风险", any("单笔风险" in r for r in d.reasons))

    # 3. 止损缺失
    print("\n[3] 止损缺失")
    d = gate.evaluate(base_order(stop_price=5389.0))
    check("无止损被拒", not d.approved, d.summary())

    # 4. 流动性
    print("\n[4] 流动性门槛")
    d = gate.evaluate(base_order(open_interest=500.0))
    check("低持仓被拒", not d.approved, d.summary())
    d = gate.evaluate(base_order(volume=10.0))
    check("低成交被拒", not d.approved, d.summary())

    # 5. 保证金上限
    print("\n[5] 保证金与集中度")
    gate2 = risk.RiskGate()
    big = base_order(lots=20, price=5389.0)     # 名义 1,078,000 > 150,000 上限
    d = gate2.evaluate(big)
    check("超名义敞口被拒", not d.approved, d.summary())

    # 6. 回撤熔断
    print("\n[6] 回撤熔断")
    gate3 = risk.RiskGate()
    gate3.update_equity(450_000)                # 回撤 -10%
    d = gate3.evaluate(base_order())
    check("熔断后拒绝开仓", not d.approved, d.summary())
    check("回撤计算正确", abs(gate3.drawdown + 0.10) < 1e-9, f"{gate3.drawdown:.2%}")

    # 7. 连续亏损减仓
    print("\n[7] 连续亏损")
    gate4 = risk.RiskGate()
    check("初始仓位系数为 1", gate4.size_multiplier == 1.0)
    for _ in range(3):
        gate4.on_trade_closed(-1000)
    check("连亏 3 笔后仓位减半", gate4.size_multiplier == 0.5,
          f"连亏={gate4.consecutive_losses}")
    cap_half = gate4.equity * 0.005 * 0.5    # 连亏会扣减权益，上限按当时权益计算
    check("风险上限同步减半",
          abs(gate4.evaluate(base_order()).metrics["risk_cap"] - cap_half) < 1e-6,
          f"cap={cap_half:.1f} equity={gate4.equity:.0f}")
    gate4.on_trade_closed(500)
    check("盈利后连亏计数归零", gate4.consecutive_losses == 0)

    # 8. 持仓数量上限
    print("\n[8] 持仓数量上限")
    gate5 = risk.RiskGate()
    for s in ("SR", "CF", "TA", "MA", "FG"):
        gate5.register_fill(base_order(symbol=s, lots=1))
    d = gate5.evaluate(base_order(symbol="OI", contract="OI2701"))
    check("超过 5 个品种被拒", not d.approved, d.summary())

    # 9. 仓位反推
    print("\n[9] 仓位反推")
    lots = risk.max_lots_by_risk(500_000, 5389.0, 5289.0, 10.0)
    check("按风险反推手数 = 2", lots == 2, str(lots))

    # 10. 信号卡
    print("\n[10] 信号卡")
    card = signal.watch_card("SR", "SR2701", "无通过验证的信号", ["样本仅 5.8 年"])
    text = card.render()
    for kw in ("决策时间", "品种 / 合约", "操作", "仓位计算", "风险审核", "主要不确定性"):
        check(f"信号卡包含「{kw}」", kw in text)
    check("观望卡明确写观望", "观望" in text)

    print("\n" + "=" * 78)
    print(f"通过 {len(PASS)} 项，失败 {len(FAIL)} 项")
    print("=" * 78)
    return 0 if not FAIL else 1


if __name__ == "__main__":
    raise SystemExit(main())
