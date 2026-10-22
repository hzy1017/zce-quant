"""Sina JSONP 行情文件读取与标准化。

原始文件形如：

    /*<script>location.href='//sina.com';</script>*/
    var _CF0=([{"d":"2005-01-04","o":"12445.000",...}]);

字段含义（阶段一已核实）：
    d 交易日 | o 开 | h 高 | l 低 | c 收 | v 成交量(手) | p 持仓量(手) | s 结算价

本模块只读原始文件，不做任何写回。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

_PAT = re.compile(r"var\s+_(\w+)\s*=\s*\((\[.*\])\);?\s*$", re.S)

# 原始字段 -> 标准字段
FIELD_MAP = {
    "d": "date",
    "o": "open",
    "h": "high",
    "l": "low",
    "c": "close",
    "v": "volume",
    "p": "open_interest",
    "s": "settle",
}
PRICE_FIELDS = ["open", "high", "low", "close", "settle"]
NUMERIC_FIELDS = PRICE_FIELDS + ["volume", "open_interest"]


class JsonpError(ValueError):
    """JSONP 结构不符合预期。"""


def parse_jsonp_text(text: str) -> tuple[str, list[dict]]:
    """从 JSONP 文本中取出变量名与数据数组。"""
    m = _PAT.search(text)
    if not m:
        raise JsonpError("未找到形如 var _X=([...]); 的 JSONP 数组")
    return m.group(1), json.loads(m.group(2))


def read_file(path: Path | str) -> pd.DataFrame:
    """读取单个 JSONP 文件，返回标准化 DataFrame（按日期升序）。"""
    path = Path(path)
    var, rows = parse_jsonp_text(path.read_text(encoding="utf-8"))
    if not rows:
        return pd.DataFrame(columns=["date", *NUMERIC_FIELDS])

    df = pd.DataFrame(rows).rename(columns=FIELD_MAP)
    missing = [c for c in FIELD_MAP.values() if c not in df.columns]
    if missing:
        raise JsonpError(f"{path.name} 缺少字段: {missing}")

    df["date"] = pd.to_datetime(df["date"], format="%Y-%m-%d", errors="coerce")
    for col in NUMERIC_FIELDS:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df[["date", *NUMERIC_FIELDS]].sort_values("date").reset_index(drop=True)
    df.attrs["var"] = var
    df.attrs["source"] = str(path)
    return df


def read_dir(dirpath: Path | str, pattern: str = "*.js") -> dict[str, pd.DataFrame]:
    """读取目录下全部 JSONP 文件，返回 {变量名: DataFrame}。"""
    dirpath = Path(dirpath)
    out: dict[str, pd.DataFrame] = {}
    for f in sorted(dirpath.glob(pattern)):
        df = read_file(f)
        out[df.attrs["var"]] = df
    return out


def read_dir_overlay(
    dirpaths: list[Path | str], pattern: str = "*.js"
) -> dict[str, pd.DataFrame]:
    """按顺序读取多个目录，**后者覆盖前者同名文件**。

    用于“审计快照 + 增量刷新”合并：快照提供完整历史，
    raw_live/contracts_live 提供最新交易日而不改动快照。
    """
    out: dict[str, pd.DataFrame] = {}
    for d in dirpaths:
        d = Path(d)
        if not d.exists():
            continue
        for f in sorted(d.glob(pattern)):
            df = read_file(f)
            out[df.attrs["var"]] = df
    return out


def split_contract(code: str) -> tuple[str, str | None]:
    """拆分代码。CF0 -> ('CF', None)；CF2201 -> ('CF', '2201')。"""
    m = re.fullmatch(r"([A-Z]{1,2})(\d{0,4})", code)
    if not m:
        raise JsonpError(f"无法解析合约代码: {code}")
    return m.group(1), (m.group(2) or None)
