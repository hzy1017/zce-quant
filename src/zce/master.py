"""合约主数据：从官方模拟终端读取合约规格与费率。

数据来源（均为本机只读文件）：
1. CspAccessApi.F10.pub   —— 合约规格表（交易单位/最小变动/涨跌停/交易时间/
                              最后交易日/保证金/手续费），CSV，权威。
2. CspAccessApi.Commodity.pub —— 品种主数据（FCommodityDot = 合约乘数）。
3. EsTrade.CalcParam.pri  —— 二进制逐合约参数（手续费已含 1.5 倍、月度保证金率），
                              用作交叉验证。

重要：F10 与 Commodity 未给出“手续费是否已乘 1.5”，但 CalcParam 中
CF 手续费 6.45 = 4.3 × 1.5、AP 7.5 = 5 × 1.5，说明 CalcParam 为比赛口径，
而 F10 为交易所口径。本模块两者都保留，绝不混用。
"""
from __future__ import annotations

import csv
import io
import re
import struct
from pathlib import Path

import pandas as pd

from . import config

_NUM = re.compile(r"([\d.]+)")


def _num(text: str) -> float | None:
    m = _NUM.search(text or "")
    return float(m.group(1)) if m else None


def _parse_fee(text: str) -> tuple[str, float | None]:
    """解析手续费文本。

    返回 (kind, value)：
        ('per_lot', 3.0)      -> 3 元/手
        ('rate', 0.0010)      -> 成交金额万分之 10
        ('unknown', None)
    """
    if not text:
        return "unknown", None
    m = re.search(r"([\d.]+)\s*元\s*/\s*手", text)
    if m:
        return "per_lot", float(m.group(1))
    m = re.search(r"万分之\s*([\d.]+)", text)
    if m:
        return "rate", float(m.group(1)) / 10000.0
    return "unknown", None


def _parse_unit_multiplier(text: str) -> float | None:
    """从交易单位文本解析乘数，如 '15吨/手' -> 15.0。"""
    if not text:
        return None
    m = re.search(r"([\d.]+)\s*吨\s*/\s*手", text)
    return float(m.group(1)) if m else None


def load_f10(path: Path | None = None) -> pd.DataFrame:
    """读取 F10 合约规格表，仅保留郑商所期货。

    未显式传入 path 时依赖 config 中的终端路径；未配置会给出可读错误。
    """
    if path is None:
        config.require_terminal()
    path = Path(path or config.F10_FILE)
    text = path.read_text(encoding="utf-8", errors="replace")
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise ValueError("F10 文件为空")
    hdr = rows[0]
    idx = {h: i for i, h in enumerate(hdr)}

    def g(r: list[str], key: str) -> str:
        i = idx.get(key)
        return r[i].strip() if i is not None and i < len(r) else ""

    records = []
    for r in rows[1:]:
        if not r or not r[0].startswith("ZCE|F|"):
            continue
        fee_kind, fee_value = _parse_fee(g(r, "FTradingFee"))
        tt = g(r, "FTradingTime")
        unit_text = g(r, "FUnit")
        mult_dot = _num(g(r, "FCommodityDot"))
        mult_unit = _parse_unit_multiplier(unit_text)
        records.append(
            {
                "code": g(r, "FCode"),
                "name": g(r, "FChsName"),
                "unit_text": unit_text,
                "tick": _num(g(r, "FTick")),
                # 乘数优先取自交易单位文本；FCommodityDot 存在缺失（如 PR）
                "multiplier": mult_unit if mult_unit is not None else mult_dot,
                "multiplier_dot": mult_dot,
                "multiplier_source": "FUnit" if mult_unit is not None else "FCommodityDot",
                "limit_text": g(r, "FRaisingLimit"),
                "trading_time": tt,
                "has_night": "21:00" in tt,
                "last_trading_rule": g(r, "FLastTradingDate"),
                "margin_text": g(r, "FTradingMargin"),
                "base_margin": _num(g(r, "FBasicMarginParam")),
                "fee_text": g(r, "FTradingFee"),
                "fee_kind": fee_kind,
                "fee_value": fee_value,
            }
        )

    df = pd.DataFrame(records).sort_values("code").reset_index(drop=True)
    df["fee_contest"] = df["fee_value"].apply(
        lambda v: None if pd.isna(v) else v * config.CONTEST_FEE_MULTIPLIER
    )
    df["tradable"] = ~df["code"].isin(config.DEAD_SYMBOLS)
    return df


def load_calcparam(path: Path | None = None) -> pd.DataFrame:
    """解析二进制逐合约参数（手续费 / 保证金率）。

    结构（阶段二逆向确认，已用 SR/CF/AP 数值验证）：
        8 字节头 = <recordSize:uint32, recordCount:uint32>，记录定长 306 字节；
        记录内：0-19 用户名 | 21-31 交易所 | 32-43 品种(如 FCF) | 44-55 月份 |
                66-77 账号 | 133 手续费(double) | 173 多头保证金率 | 189 空头保证金率
    """
    path = Path(path or config.CALCPARAM_FILE)
    raw = path.read_bytes()
    size, count = struct.unpack_from("<II", raw, 0)
    if 8 + size * count != len(raw):
        raise ValueError("CalcParam 尺寸校验失败，格式可能已变更")

    def s(rec: bytes, a: int, b: int) -> str:
        return rec[a:b].split(b"\x00")[0].decode("ascii", "replace")

    out = []
    for i in range(count):
        rec = raw[8 + i * size : 8 + (i + 1) * size]
        comm = s(rec, 32, 44)
        if not comm.startswith("F"):
            continue
        fee = struct.unpack_from("<d", rec, 133)[0]
        m_long = struct.unpack_from("<d", rec, 173)[0]
        m_short = struct.unpack_from("<d", rec, 189)[0]
        if fee == 0 and m_long == 0:
            continue
        out.append(
            {
                "code": comm[1:],
                "month": s(rec, 44, 56),
                "fee_contest_calc": round(fee, 6),
                "margin_long": round(m_long, 6),
                "margin_short": round(m_short, 6),
            }
        )
    return pd.DataFrame(out).sort_values(["code", "month"]).reset_index(drop=True)


def reconcile_fees(f10: pd.DataFrame, calc: pd.DataFrame) -> pd.DataFrame:
    """对比“F10 汇率文本”与“终端实际计费参数”。

    背景（阶段三实测）：13 个品种两者完全吻合（CalcParam = F10 × 1.5），
    3 个品种恒定但不等（CY/JR/PF），12 个品种随合约月或价格变化
    （存在月度优惠费率或按成交金额计费）。

    status：
        match              终端计费 = F10 × 1.5
        constant_mismatch  恒定但不等于 F10 × 1.5
        month_varying      随合约月变化，不能压成单一“元/手”
        f10_fee_unknown    F10 未给出可解析费率（按成交金额计费）
        no_calc_record     CalcParam 无该品种记录
    """
    c = calc[calc["month"].astype(str).str.len() > 0]
    g = c.groupby("code")["fee_contest_calc"]
    stats = pd.DataFrame(
        {"calc_min": g.min(), "calc_max": g.max(), "n_months": g.size()}
    ).reset_index()
    df = f10[["code", "name", "fee_text", "fee_kind", "fee_value", "fee_contest"]].merge(
        stats, on="code", how="left"
    )
    df["calc_varies"] = (df["calc_max"] - df["calc_min"]) > 1e-9

    def _status(r: pd.Series) -> str:
        if pd.isna(r["calc_min"]):
            return "no_calc_record"
        if r["calc_varies"]:
            return "month_varying"
        if pd.isna(r["fee_contest"]):
            return "f10_fee_unknown"
        return "match" if abs(r["calc_min"] - r["fee_contest"]) < 1e-6 else "constant_mismatch"

    df["status"] = df.apply(_status, axis=1)
    return df.sort_values(["status", "code"]).reset_index(drop=True)
