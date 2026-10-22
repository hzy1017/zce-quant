"""日频回测内核。

设计要点（对应比赛要求第 5、7 条）：
1. **不使用未来数据**：t 日收盘后生成信号，t+1 日**开盘**成交。
2. **真实合约**：持仓绑定具体合约（如 SR2701），盈亏按该合约真实价格逐日结算。
3. **不做价格复权**：换月当日盈亏归零（卖旧买新），另计一次往返成本。
   这避免了差额复权在长周期/大价差品种上产生负价格的问题（实测 CJ 会出现）。
   信号使用“换月收益归零”构造的总收益指数，仅用于计算动量与波动率。
4. **成本**：手续费取终端逐合约参数（已含 1.5 倍），滑点默认 1 跳。
5. **约束**：整数手、保证金占用上限、封板（H==L）与零成交不成交。
6. 记录逐笔交易与每日权益，指标可复核。
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import config


# ---------------------------------------------------------------- 规格与成本
def load_specs() -> dict[str, dict]:
    """返回 {品种: {mult, tick, fee_map, margin_map, default_fee, default_margin}}"""
    from . import master

    f10 = master.load_f10().set_index("code")
    calc = master.load_calcparam()
    calc["m3"] = calc["month"].astype(str).str.strip()

    specs: dict[str, dict] = {}
    for code, row in f10.iterrows():
        sub = calc[calc["code"] == code]
        fee_map = dict(zip(sub["m3"], sub["fee_contest_calc"])) if len(sub) else {}
        mar_map = dict(zip(sub["m3"], sub["margin_long"])) if len(sub) else {}
        default_fee = float(sub["fee_contest_calc"].median()) if len(sub) else (
            float(row["fee_contest"]) if pd.notna(row["fee_contest"]) else 0.0
        )
        default_margin = float(sub["margin_long"].median()) if len(sub) else (
            float(row["base_margin"]) if pd.notna(row["base_margin"]) else 0.10
        )
        specs[code] = {
            "mult": float(row["multiplier"]),
            "tick": float(row["tick"]),
            "fee_map": fee_map,
            "margin_map": mar_map,
            "default_fee": default_fee,
            "default_margin": max(default_margin, 0.05),
            "has_night": bool(row["has_night"]),
        }
    return specs


def contract_month(contract: str) -> str:
    """'SR2701' -> '701'（CalcParam 使用三位月份）。"""
    m = contract[-4:]
    return m[1:] if len(m) == 4 and m[0] == "2" else m


def fee_per_lot(spec: dict, contract: str) -> float:
    """每手手续费（元/手），按合约月取；缺失回退该品种中位数。"""
    fee = spec["fee_map"].get(contract_month(contract))
    return float(spec["default_fee"] if fee is None else fee)


# ---------------------------------------------------------------- 数据准备
def load_main(dataset: str = "live") -> pd.DataFrame:
    d = config.CLEAN_LIVE_DIR if dataset == "live" else config.CLEAN_DIR
    df = pd.read_csv(d / "main_series.csv", parse_dates=["date"])
    return df.sort_values(["symbol", "date"]).reset_index(drop=True)


def prepare(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """按品种构造：真实价格 + 换月标记 + 总收益指数（换月收益置 0）。

    idx 仅用于信号（动量/波动），**不用于成交与盈亏**。
    """
    out: dict[str, pd.DataFrame] = {}
    for sym, g in df.groupby("symbol", sort=True):
        g = g.sort_values("date").reset_index(drop=True).copy()
        g["roll"] = (g["contract"] != g["contract"].shift()).fillna(True)
        prev_close = g["close"].shift(1)
        ret = g["close"] / prev_close - 1.0
        ret = ret.where(~g["roll"], 0.0).fillna(0.0)
        g["ret"] = ret
        g["idx"] = (1.0 + ret).cumprod()
        g["prev_close"] = prev_close
        out[sym] = g
    return out


# ---------------------------------------------------------------- 指标
def _metrics(eq: pd.Series) -> dict:
    if len(eq) < 2:
        return {}
    r = eq.pct_change().dropna()
    yrs = len(eq) / 244.0
    total = eq.iloc[-1] / eq.iloc[0] - 1
    cagr = (eq.iloc[-1] / eq.iloc[0]) ** (1 / yrs) - 1 if yrs > 0 and eq.iloc[0] > 0 else np.nan
    peak = eq.cummax()
    dd = eq / peak - 1
    mdd = dd.min()
    sd = r.std(ddof=1)
    sharpe = r.mean() / sd * math.sqrt(244) if sd and sd > 0 else np.nan
    downside = r[r < 0]
    dsd = downside.std(ddof=1) if len(downside) > 1 else np.nan
    sortino = r.mean() / dsd * math.sqrt(244) if dsd and dsd > 0 else np.nan
    return {
        "days": int(len(eq)),
        "years": round(yrs, 2),
        "total_return": round(float(total), 4),
        "cagr": round(float(cagr), 4),
        "max_drawdown": round(float(mdd), 4),
        "sharpe": round(float(sharpe), 3) if sharpe == sharpe else None,
        "sortino": round(float(sortino), 3) if sortino == sortino else None,
        "calmar": round(float(cagr / abs(mdd)), 3) if mdd and mdd < 0 and cagr == cagr else None,
        "vol_annual": round(float(sd * math.sqrt(244)), 4) if sd and sd == sd else None,
    }


# ---------------------------------------------------------------- 回测
@dataclass
class BTConfig:
    start: str
    end: str
    initial_equity: float = config.CONTEST_INITIAL_EQUITY
    slip_ticks: float = 1.0
    margin_cap: float = 0.80
    rebalance_days: int = 20
    max_positions: int = 5
    n_slots: int = 5                  # 该策略计划同时持有的品种数（决定单品种仓位）
    vol_target: float = 0.12
    vol_lookback: int = 60
    max_weight: float = 0.30
    max_leverage: float = 3.0
    weight_mode: str = "vol"          # "vol"=波动率目标；"equal"=等权（用于基准）


def run_backtest(
    panel: dict[str, pd.DataFrame],
    specs: dict[str, dict],
    targets: pd.DataFrame,
    cfg: BTConfig,
) -> dict:
    """targets: index=date, columns=symbol, values=目标方向(-1/0/1)。"""
    dates = sorted(set().union(*[set(df["date"]) for df in panel.values()]))
    dates = [d for d in dates if pd.Timestamp(cfg.start) <= d <= pd.Timestamp(cfg.end)]
    if len(dates) < 30:
        raise ValueError("回测区间过短")

    idx = {s: df.set_index("date") for s, df in panel.items()}

    cash = cfg.initial_equity
    positions: dict[str, dict] = {}
    eq_curve, trades, margins = [], [], []
    pending: dict[str, int] = {}
    last_rebal = None

    def _open(sym: str, direction: int, d, row, equity_now: float) -> None:
        nonlocal cash
        spec = specs[sym]
        px = float(row["open"])
        hist = idx[sym].loc[:d, "ret"].tail(cfg.vol_lookback)
        sigma = float(hist.std() * math.sqrt(244)) if len(hist) > 5 else np.nan
        if cfg.weight_mode == "equal":
            w = min(cfg.max_weight, 1.0 / max(1, cfg.n_slots))
        else:
            if not (sigma == sigma) or sigma <= 0:
                return
            w = min(cfg.max_weight, cfg.vol_target / sigma / max(1, cfg.n_slots))
        lots = int((equity_now * w) // (px * spec["mult"]))
        if lots <= 0:
            return
        mg = lots * px * spec["mult"] * spec["default_margin"]
        cur_margin = sum(margins[-1].values()) if margins else 0.0
        if cur_margin + mg > equity_now * cfg.margin_cap:
            return
        cost = lots * fee_per_lot(spec, str(row["contract"])) + \
            lots * cfg.slip_ticks * spec["tick"] * spec["mult"]
        cash -= cost
        positions[sym] = {
            "contract": str(row["contract"]), "lots": direction * lots,
            "prev_close": float(row["close"]), "pnl": 0.0,
            "entry_date": d, "mult": spec["mult"],
            "entry_px": px,
        }
        trades.append({"date": d, "symbol": sym, "contract": str(row["contract"]),
                       "side": "开", "lots": lots, "price": round(px, 3),
                       "cost": round(cost, 2), "pnl": 0.0, "hold_days": 0})

    def _close(sym: str, d, row) -> None:
        nonlocal cash
        p = positions[sym]
        spec = specs[sym]
        px = float(row["open"])
        cost = abs(p["lots"]) * fee_per_lot(spec, p["contract"]) + \
            abs(p["lots"]) * cfg.slip_ticks * spec["tick"] * spec["mult"]
        cash += p["pnl"] - cost
        trades.append({"date": d, "symbol": sym, "contract": p["contract"], "side": "平",
                       "lots": abs(p["lots"]), "price": round(px, 3),
                       "cost": round(cost, 2), "pnl": round(p["pnl"] - cost, 2),
                       "hold_days": (d - p["entry_date"]).days})
        positions.pop(sym)

    for i, d in enumerate(dates):
        # ---- 1) 开盘执行昨日决定 ----
        for sym, direction in list(pending.items()):
            if sym not in idx or d not in idx[sym].index:
                continue
            row = idx[sym].loc[d]
            if row["high"] == row["low"] or row["volume"] <= 0:
                continue                      # 封板 / 无成交
            hold = positions.get(sym)
            cur = int(np.sign(hold["lots"])) if hold else 0
            if direction == cur:
                continue
            if hold:
                _close(sym, d, row)
            if direction != 0:
                _open(sym, direction, d, row, cash + sum(p["pnl"] for p in positions.values()))
        pending = {}

        # ---- 2) 收盘盯市 ----
        for sym, p in positions.items():
            if d not in idx[sym].index:
                continue
            row = idx[sym].loc[d]
            new_contract = str(row["contract"])
            if new_contract != p["contract"]:
                spec = specs[sym]
                cost = (abs(p["lots"]) * fee_per_lot(spec, p["contract"])
                        + abs(p["lots"]) * fee_per_lot(spec, new_contract)
                        + 2 * abs(p["lots"]) * cfg.slip_ticks * spec["tick"] * spec["mult"])
                cash -= cost
                trades.append({"date": d, "symbol": sym,
                               "contract": f"{p['contract']}→{new_contract}",
                               "side": "换月", "lots": abs(p["lots"]),
                               "price": round(float(row["close"]), 3),
                               "cost": round(cost, 2), "pnl": round(-cost, 2), "hold_days": 0})
                p["contract"] = new_contract
                p["prev_close"] = float(row["close"])
            else:
                p["pnl"] += p["lots"] * p["mult"] * (float(row["close"]) - p["prev_close"])
                p["prev_close"] = float(row["close"])

        equity = cash + sum(p["pnl"] for p in positions.values())
        margin_now = {
            s: abs(p["lots"]) * p["prev_close"] * p["mult"] * specs[s]["default_margin"]
            for s, p in positions.items()
        }
        margins.append(margin_now)
        eq_curve.append({"date": d, "equity": round(equity, 2), "n_pos": len(positions),
                         "margin": round(sum(margin_now.values()), 2)})

        # ---- 3) 收盘后决定次日 ----
        if i + 1 >= len(dates) or d not in targets.index:
            continue
        row_t = targets.loc[d]
        need = {}
        for sym in panel:
            if sym not in targets.columns:
                continue
            val = row_t.get(sym, 0)
            tgt = 0 if pd.isna(val) else int(val)
            hold = positions.get(sym)
            cur = int(np.sign(hold["lots"])) if hold else 0
            if tgt != cur:
                need[sym] = tgt
        if need or last_rebal is None or (i - last_rebal) >= cfg.rebalance_days:
            last_rebal = i
        pending = need

    curve = pd.DataFrame(eq_curve)
    tr = pd.DataFrame(trades)
    stats = _metrics(curve.set_index("date")["equity"])
    if len(tr):
        closed = tr[tr["side"] == "平"]
        win = closed[closed["pnl"] > 0]["pnl"]
        loss = closed[closed["pnl"] < 0]["pnl"]
        stats.update({
            "trades": int(len(tr)),
            "round_trips": int(len(closed)),
            "win_rate": round(float(len(win) / len(closed)), 3) if len(closed) else None,
            "avg_win": round(float(win.mean()), 2) if len(win) else None,
            "avg_loss": round(float(loss.mean()), 2) if len(loss) else None,
            "profit_factor": round(float(win.sum() / abs(loss.sum())), 3)
            if len(loss) and loss.sum() != 0 else None,
            "total_cost": round(float(tr["cost"].sum()), 2),
            "cost_ratio": round(float(tr["cost"].sum() / cfg.initial_equity), 4),
        })
    stats["final_equity"] = round(float(curve["equity"].iloc[-1]), 2) if len(curve) else None
    stats["max_margin_pct"] = round(float((curve["margin"] / curve["equity"]).max()), 4) \
        if len(curve) else None
    return {"equity": curve, "trades": tr, "stats": stats}
