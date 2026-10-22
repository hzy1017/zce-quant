"""期限结构（carry / 展期收益）因子。

经济逻辑（与价格动量机制不同）：
    期货价格 = 现货预期 + 持有成本/便利收益。当近月高于远月（backwardation，
    现货紧张）时，多头在换月时“卖高买低”，获得正的展期收益；反之
    （contango）持有成本为负。商品期货的 carry 溢价在文献中被广泛记录。

因子定义（年化）：
    carry = (P_near - P_far) / P_far × (12 / Δmonths)
    Δmonths = 远月与近月的月份差；>0 表示 backwardation（做多有利）。

实现约定：
1. 每个交易日、每个品种，取**仍在交易**且满足流动性门槛的两个最近月份合约。
2. 只用当日收盘价，t 日信号在 t+1 开盘执行（由回测引擎保证）。
3. 价差按月份差年化；月份差按自然月近似 30.44 天，属简化，已在报告中声明。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config


def _ym(month: str) -> int:
    """'2701' -> 2027*12+1。"""
    m = str(month).strip()
    return (2000 + int(m[:2])) * 12 + int(m[2:])


def build_curve(contracts: pd.DataFrame, min_oi: float = 1000.0) -> pd.DataFrame:
    """返回近/远月配对表：symbol, date, near, far, p_near, p_far, carry_ann。"""
    df = contracts[contracts["usable"]].copy()
    df = df[df["month"].notna()]
    df["ym"] = df["month"].map(_ym)
    df = df[df["volume"] > 0].sort_values(["symbol", "date", "ym"])

    df["rank"] = df.groupby(["symbol", "date"]).cumcount()
    near = df[df["rank"] == 0][["symbol", "date", "contract", "ym", "close", "open_interest"]]
    far = df[df["rank"] == 1][["symbol", "date", "contract", "ym", "close", "open_interest"]]
    pair = near.merge(far, on=["symbol", "date"], suffixes=("_n", "_f"))
    pair = pair[(pair["open_interest_n"] >= min_oi) & (pair["open_interest_f"] >= min_oi)]
    pair = pair[pair["close_f"] > 0]

    dmonths = pair["ym_f"] - pair["ym_n"]
    pair = pair[dmonths > 0].copy()
    dmonths = dmonths[dmonths > 0]
    pair["carry_ann"] = (pair["close_n"] - pair["close_f"]) / pair["close_f"] * (12.0 / dmonths)
    pair = pair.replace([np.inf, -np.inf], np.nan).dropna(subset=["carry_ann"])
    return pair.reset_index(drop=True)


def carry_matrix(pair: pd.DataFrame) -> pd.DataFrame:
    """date × symbol 的年化 carry 矩阵。"""
    return pair.pivot_table(index="date", columns="symbol", values="carry_ann", aggfunc="first").sort_index()


def load_contracts(dataset: str = "live") -> pd.DataFrame:
    d = config.CLEAN_LIVE_DIR if dataset == "live" else config.CLEAN_DIR
    df = pd.read_csv(d / "contracts_clean.csv", parse_dates=["date"])
    return df
