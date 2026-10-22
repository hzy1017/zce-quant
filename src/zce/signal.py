"""信号卡（阶段八）：把每一次决策写成可复核的文本。

硬性要求：不允许出现“看涨/建议买入”这类无依据结论。
没有通过验证的策略时，信号卡必须输出**观望**并写明原因。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class SignalCard:
    asof: str                      # 决策时间
    symbol: str
    contract: str
    action: str                    # 开多 / 开空 / 平仓 / 观望
    strategy: str
    rationale: str                 # 理论依据
    trigger: str                   # 触发条件与计算值
    entry_plan: str
    exit_plan: str
    invalidate: str                # 失效条件
    sizing: str                    # 仓位计算过程
    risk_reward: str               # 预期收益与风险估算（含假设）
    cost_liquidity: str
    margin: str
    risk_review: str
    uncertainties: list[str] = field(default_factory=list)

    FIELDS = [
        ("决策时间", "asof"),
        ("品种 / 合约", "sym_contract"),
        ("操作", "action"),
        ("策略与理论依据", "strategy_rationale"),
        ("触发条件与计算值", "trigger"),
        ("计划入场", "entry_plan"),
        ("退出条件", "exit_plan"),
        ("失效条件", "invalidate"),
        ("仓位计算", "sizing"),
        ("预期收益与风险（含假设）", "risk_reward"),
        ("成本与流动性", "cost_liquidity"),
        ("保证金占用", "margin"),
        ("风险审核", "risk_review"),
    ]

    def _value(self, key: str) -> str:
        if key == "sym_contract":
            return f"{self.symbol} / {self.contract}"
        if key == "strategy_rationale":
            return f"{self.strategy} —— {self.rationale}"
        return str(getattr(self, key))

    def render(self) -> str:
        lines = [f"# 信号卡 {self.symbol} {self.contract}", ""]
        lines.append("| 项目 | 内容 |")
        lines.append("|---|---|")
        for label, key in self.FIELDS:
            lines.append(f"| {label} | {self._value(key)} |")
        lines.append("")
        if self.uncertainties:
            lines.append("**主要不确定性**：")
            for u in self.uncertainties:
                lines.append(f"- {u}")
        return "\n".join(lines)


def watch_card(symbol: str, contract: str, reason: str,
               details: list[str] | None = None) -> SignalCard:
    """无有效信号时的观望卡：明确写清“为什么不做”。"""
    return SignalCard(
        asof=datetime.now().strftime("%Y-%m-%d %H:%M"),
        symbol=symbol,
        contract=contract,
        action="观望",
        strategy="无（未通过验证的策略不予采用）",
        rationale="项目内所有已检验信号（动量、期限结构）均未通过统计显著性与成本门槛，"
                  "按既定纪律不开仓。",
        trigger="不适用——本卡由“无信号”触发",
        entry_plan="不适用",
        exit_plan="不适用",
        invalidate=reason,
        sizing="0 手（观望不占用保证金）",
        risk_reward="不承担风险，也不产生收益",
        cost_liquidity="不发生交易成本",
        margin="0 元",
        risk_review="通过（空仓不触发任何风险限额）",
        uncertainties=(details or []) + [
            "数据未实时刷新时，任何判断都可能过期",
            "若不交易，比赛活跃度分可能受损（规则要求活跃交易日 ≥5 天）",
        ],
    )
