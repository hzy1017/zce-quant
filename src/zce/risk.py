"""独立风险审核层（阶段六）。

定位：所有策略信号在进入执行前，必须先通过本模块。它只做一件事——
**能否开这一笔仓**，并给出可复核的计算过程与拒绝理由。

规则来源：
- 账户规模 50 万、手续费 1.5 倍：郑商函〔2026〕670 号
- 保证金率、乘数、最小变动：终端 F10 与 CalcParam（阶段二/三已核实）
- 单笔风险、集中度等阈值：本项目设定，属**建议值**，需使用者确认

设计原则：
1. 默认拒绝。任何一项不达标即拒绝，并记录原因。
2. 不预测收益，只约束风险。
3. 止损价是计划价，不是保证成交价；本模块不假设止损一定能成交。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import config


@dataclass
class RiskConfig:
    initial_equity: float = config.CONTEST_INITIAL_EQUITY
    max_risk_per_trade: float = 0.005      # 单笔最大亏损占权益 0.5%
    max_notional_per_symbol: float = 0.30  # 单品种名义敞口上限
    max_total_margin: float = 0.60         # 组合保证金占用上限
    max_positions: int = 5
    max_drawdown_halt: float = 0.08        # 回撤超过 8% 停止开新仓
    max_consecutive_losses: int = 3        # 连续亏损 3 笔后仓位减半
    min_open_interest: float = 10_000      # 主力合约持仓下限（手）
    min_volume: float = 1_000              # 日成交量下限（手）
    max_lots_per_order: int = 50


@dataclass
class Order:
    """待审核订单。stop_price 为计划止损价，不保证成交。"""
    symbol: str
    contract: str
    direction: int                 # +1 多 / -1 空
    lots: int
    price: float
    stop_price: float
    mult: float                    # 合约乘数
    tick: float
    margin_rate: float
    volume: float = 0.0
    open_interest: float = 0.0
    fee_per_lot: float = 0.0
    slip_ticks: float = 1.0


@dataclass
class Decision:
    approved: bool
    reasons: list[str] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)

    def summary(self) -> str:
        head = "通过" if self.approved else "拒绝"
        tail = "；".join(self.reasons) if self.reasons else "无"
        return f"[{head}] {tail}"


class RiskGate:
    """有状态的风险闸门：维护权益、峰值、连亏与持仓占用。"""

    def __init__(self, cfg: RiskConfig | None = None):
        self.cfg = cfg or RiskConfig()
        self.equity = self.cfg.initial_equity
        self.peak = self.equity
        self.consecutive_losses = 0
        self.positions: dict[str, dict] = {}     # symbol -> {notional, margin, lots}

    # ---------------- 状态维护 ----------------
    def update_equity(self, equity: float) -> None:
        self.equity = float(equity)
        self.peak = max(self.peak, self.equity)

    @property
    def drawdown(self) -> float:
        return self.equity / self.peak - 1.0 if self.peak > 0 else 0.0

    def on_trade_closed(self, pnl: float, symbol: str | None = None) -> None:
        self.equity += float(pnl)
        self.peak = max(self.peak, self.equity)
        self.consecutive_losses = self.consecutive_losses + 1 if pnl < 0 else 0
        if symbol and symbol in self.positions:
            self.positions.pop(symbol, None)

    @property
    def size_multiplier(self) -> float:
        """连亏后的仓位折减系数。"""
        if self.consecutive_losses >= self.cfg.max_consecutive_losses:
            return 0.5
        return 1.0

    @property
    def margin_used(self) -> float:
        return sum(p["margin"] for p in self.positions.values())

    # ---------------- 核心审核 ----------------
    def evaluate(self, order: Order) -> Decision:
        cfg = self.cfg
        reasons: list[str] = []
        m: dict = {}

        if order.lots <= 0:
            return Decision(False, ["手数必须为正整数"], {})

        # 1. 回撤熔断
        if self.drawdown <= -cfg.max_drawdown_halt:
            reasons.append(
                f"组合回撤 {self.drawdown:.2%} 已触及熔断线 {cfg.max_drawdown_halt:.0%}，停止开新仓"
            )

        # 2. 持仓数量上限
        is_new = order.symbol not in self.positions
        if is_new and len(self.positions) >= cfg.max_positions:
            reasons.append(f"持仓品种数已达上限 {cfg.max_positions}")

        # 3. 流动性
        if order.open_interest < cfg.min_open_interest:
            reasons.append(f"持仓量 {order.open_interest:,.0f} 低于下限 {cfg.min_open_interest:,.0f}")
        if order.volume < cfg.min_volume:
            reasons.append(f"成交量 {order.volume:,.0f} 低于下限 {cfg.min_volume:,.0f}")

        # 4. 单笔风险（以计划止损价计算，不保证按该价成交）
        risk_per_lot = abs(order.price - order.stop_price) * order.mult
        risk_total = risk_per_lot * order.lots
        risk_cap = self.equity * cfg.max_risk_per_trade * self.size_multiplier
        m["risk_per_lot"] = round(risk_per_lot, 2)
        m["risk_total"] = round(risk_total, 2)
        m["risk_cap"] = round(risk_cap, 2)
        if abs(order.price - order.stop_price) <= 0:
            reasons.append("止损价与入场价相同，无法计算风险")
        elif risk_total > risk_cap:
            reasons.append(
                f"单笔风险 {risk_total:,.0f} 元超过上限 {risk_cap:,.0f} 元"
                f"（{cfg.max_risk_per_trade:.1%}×权益×连亏系数 {self.size_multiplier:.1f}）"
            )

        # 5. 名义敞口与集中度
        notional = order.price * order.mult * order.lots
        m["notional"] = round(notional, 2)
        notional_cap = self.equity * cfg.max_notional_per_symbol
        if notional > notional_cap:
            reasons.append(f"名义敞口 {notional:,.0f} 超过单品种上限 {notional_cap:,.0f}")
        existing = self.positions.get(order.symbol, {}).get("notional", 0.0)
        if existing + notional > notional_cap:
            reasons.append("叠加已有持仓后超过单品种上限")

        # 6. 保证金占用
        margin = notional * order.margin_rate
        m["margin"] = round(margin, 2)
        margin_cap = self.equity * cfg.max_total_margin
        if self.margin_used + margin > margin_cap:
            reasons.append(
                f"保证金占用 {self.margin_used + margin:,.0f} 超过上限 {margin_cap:,.0f}"
            )

        # 7. 单笔手数上限
        if order.lots > cfg.max_lots_per_order:
            reasons.append(f"单笔手数 {order.lots} 超过上限 {cfg.max_lots_per_order}")

        # 8. 成本占风险比例（成本高于潜在收益的一半则不值得做）
        cost = order.lots * (order.fee_per_lot + order.slip_ticks * order.tick * order.mult) * 2
        m["round_trip_cost"] = round(cost, 2)
        m["cost_to_risk"] = round(cost / risk_total, 3) if risk_total > 0 else None
        if risk_total > 0 and cost > 0.5 * risk_total:
            reasons.append(f"往返成本 {cost:,.0f} 元超过单笔风险的一半")

        m["drawdown"] = round(self.drawdown, 4)
        m["margin_used_before"] = round(self.margin_used, 2)
        m["size_multiplier"] = self.size_multiplier
        return Decision(approved=not reasons, reasons=reasons, metrics=m)

    def register_fill(self, order: Order) -> None:
        """成交后登记占用（由人工确认成交后调用）。"""
        notional = order.price * order.mult * order.lots
        cur = self.positions.setdefault(order.symbol, {"notional": 0.0, "margin": 0.0, "lots": 0})
        cur["notional"] += notional
        cur["margin"] += notional * order.margin_rate
        cur["lots"] += order.lots


def max_lots_by_risk(equity: float, price: float, stop: float, mult: float,
                     cfg: RiskConfig | None = None, size_multiplier: float = 1.0) -> int:
    """按单笔风险上限反推最大手数（供信号卡计算仓位用）。"""
    cfg = cfg or RiskConfig()
    per_lot = abs(price - stop) * mult
    if per_lot <= 0:
        return 0
    budget = equity * cfg.max_risk_per_trade * size_multiplier
    return max(0, int(budget // per_lot))
