"""数据质量校验与清洗规则。

设计原则（对应比赛要求第 5、6 条）：
1. 原始数据只读，清洗结果另存，绝不覆盖。
2. 可疑数据“标记”而不是“删除”，避免为了好看而丢证据。
3. 所有阈值集中在 config，可复核、可调整。
4. 不填充、不插值、不编造缺失价格。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config


def add_flags(df: pd.DataFrame, key: str = "contract") -> pd.DataFrame:
    """为单合约/连续序列添加质量标记列（不修改原值）。

    key：分组键。重复日期必须在**同一合约内**判断，否则拼接表的同一天
    会被误判为重复（阶段三首次运行即踩此坑）。
    """
    out = df.copy()
    o, h, l, c = out["open"], out["high"], out["low"], out["close"]

    out["flag_dup_date"] = out.duplicated(subset=[key, "date"], keep=False)
    out["flag_nonpos"] = (out[["open", "high", "low", "close"]] <= 0).any(axis=1)
    out["flag_ohlc"] = (l > h) | (l > np.minimum(o, c) + 1e-9) | (h < np.maximum(o, c) - 1e-9)
    out["flag_settle_zero"] = out["settle"].fillna(0) <= 0
    out["flag_zero_vol"] = out["volume"].fillna(0) < config.MIN_VOLUME
    out["flag_zero_oi"] = out["open_interest"].fillna(0) <= 0

    rng = (h - l) / c.replace(0, np.nan)
    out["flag_range"] = rng > config.RANGE_SUSPECT
    wick = (np.minimum(o, c) - l) / np.minimum(o, c).replace(0, np.nan)
    out["flag_wick"] = wick > config.WICK_SUSPECT

    flag_cols = [c for c in out.columns if c.startswith("flag_")]
    out["qc_suspect"] = out[flag_cols].any(axis=1)
    return out


def clean(df: pd.DataFrame) -> pd.DataFrame:
    """生成清洗视图。

    - settle==0 视为缺失（NaN），而不是真实结算价 0。
    - 价格字段保持原值，不做插值。
    - 保留全部行，仅以 settled 列标注可用性。
    """
    out = df.copy()
    out["settle_raw"] = out["settle"]
    out.loc[out["settle"] <= 0, "settle"] = np.nan
    out["usable"] = (
        (~out["flag_ohlc"])
        & (~out["flag_nonpos"])
        & (~out["flag_zero_vol"])
        & out["close"].notna()
    )
    return out


def monotonic_dates(df: pd.DataFrame) -> bool:
    return bool(df["date"].is_monotonic_increasing)


def missing_days(df: pd.DataFrame, calendar: pd.DatetimeIndex) -> pd.DataFrame:
    """对比参考交易日历，返回缺失的日期。"""
    have = set(pd.to_datetime(df["date"]))
    lo, hi = df["date"].min(), df["date"].max()
    window = calendar[(calendar >= lo) & (calendar <= hi)]
    missing = [d for d in window if d not in have]
    return pd.DataFrame({"date": missing})


def summary(df: pd.DataFrame, label: str, key: str | None = None) -> dict:
    """单个数据集的质控摘要。"""
    if key and key in df.columns:
        sorted_ok = bool(df.groupby(key)["date"].apply(lambda s: s.is_monotonic_increasing).all())
    else:
        sorted_ok = monotonic_dates(df)
    return {
        "sorted_ok": sorted_ok,
        "label": label,
        "rows": int(len(df)),
        "start": str(df["date"].min().date()) if len(df) else None,
        "end": str(df["date"].max().date()) if len(df) else None,
        "dup_dates": int(df["flag_dup_date"].sum()) if "flag_dup_date" in df else 0,
        "ohlc_bad": int(df["flag_ohlc"].sum()) if "flag_ohlc" in df else 0,
        "nonpos": int(df["flag_nonpos"].sum()) if "flag_nonpos" in df else 0,
        "settle_zero": int(df["flag_settle_zero"].sum()) if "flag_settle_zero" in df else 0,
        "zero_vol": int(df["flag_zero_vol"].sum()) if "flag_zero_vol" in df else 0,
        "zero_oi": int(df["flag_zero_oi"].sum()) if "flag_zero_oi" in df else 0,
        "range_suspect": int(df["flag_range"].sum()) if "flag_range" in df else 0,
        "wick_suspect": int(df["flag_wick"].sum()) if "flag_wick" in df else 0,
        "suspect_rows": int(df["qc_suspect"].sum()) if "qc_suspect" in df else 0,
    }
