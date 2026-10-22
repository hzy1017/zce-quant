"""阶段三主流程：读取 -> 校验 -> 清洗 -> 落盘。

可重复运行：输出按固定顺序排序，并对每个产物记录 sha256，便于验证幂等性。
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd

from . import clean, config, jsdata, master

OUTPUTS: dict[str, Path] = {}


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_contracts(dirs: list[Path]) -> pd.DataFrame:
    """读取全部单合约文件（多目录时后覆盖前），附加代码/品种/月份。"""
    frames = []
    for var, df in jsdata.read_dir_overlay(dirs).items():
        symbol, month = jsdata.split_contract(var)
        df = df.copy()
        df["contract"] = var
        df["symbol"] = symbol
        df["month"] = month
        frames.append(df)
    if not frames:
        raise RuntimeError("contracts 目录为空")
    out = pd.concat(frames, ignore_index=True)
    return out.sort_values(["contract", "date"]).reset_index(drop=True)


def load_continuous(dirs: list[Path]) -> pd.DataFrame:
    frames = []
    for var, df in jsdata.read_dir_overlay(dirs).items():
        symbol, _ = jsdata.split_contract(var)
        df = df.copy()
        df["symbol"] = symbol
        df["series"] = var
        frames.append(df)
    out = pd.concat(frames, ignore_index=True)
    return out.sort_values(["series", "date"]).reset_index(drop=True)


def _paths(dataset: str) -> tuple[list[Path], list[Path], Path, Path]:
    """按数据集选择输入目录与输出目录。

    snapshot —— 阶段一审计快照（不改动，用于回归测试）
    live     —— 快照 + 增量刷新（后者覆盖同名文件）
    """
    if dataset == "snapshot":
        return [config.RAW_DIR], [config.CONTRACT_DIR], config.CLEAN_DIR, config.META_DIR
    if dataset == "live":
        return (
            [config.RAW_DIR, config.LIVE_RAW_DIR],
            [config.CONTRACT_DIR, config.LIVE_CONTRACT_DIR],
            config.CLEAN_LIVE_DIR,
            config.META_LIVE_DIR,
        )
    raise ValueError(f"未知数据集: {dataset}")


def build_calendar(continuous: pd.DataFrame, contracts: pd.DataFrame) -> pd.DatetimeIndex:
    """参考交易日历：取全部序列出现过的交易日并集。"""
    days = pd.concat([continuous["date"], contracts["date"]]).dropna().unique()
    return pd.DatetimeIndex(sorted(pd.to_datetime(days)))


def build_main_series(contracts: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """重建“逐日真实主力合约”序列。

    规则：每个交易日、每个品种，取当日持仓量最大的仍在交易的真实合约。
    这与 Sina 的 *_0 连续序列不同——后者是拼接序列，价格不连续。
    """
    sub = contracts[contracts["usable"]].copy()
    ranked = sub.sort_values(
        ["symbol", "date", "open_interest", "volume"],
        ascending=[True, True, False, False],
    )
    main = ranked.drop_duplicates(["symbol", "date"], keep="first").copy()
    main = main.sort_values(["symbol", "date"]).reset_index(drop=True)

    main["prev_contract"] = main.groupby("symbol")["contract"].shift()
    rolls = main[main["prev_contract"].notna() & (main["contract"] != main["prev_contract"])].copy()
    rolls = rolls[["symbol", "date", "prev_contract", "contract", "close", "settle", "open_interest"]]
    return main, rolls.reset_index(drop=True)


def run(dataset: str = "snapshot") -> dict:
    config.ensure_dirs()
    raw_dirs, con_dirs, clean_dir, meta_dir = _paths(dataset)
    manifest = {"generated_by": "zce.build", "dataset": dataset, "outputs": {}}

    # --- 读取 ---
    contracts = load_contracts(con_dirs)
    continuous = load_continuous(raw_dirs)
    calendar = build_calendar(continuous, contracts)

    # --- 校验 + 清洗 ---
    contracts = clean.clean(clean.add_flags(contracts, key="contract"))
    continuous = clean.clean(clean.add_flags(continuous, key="series"))

    # --- 合约主数据 ---
    f10 = master.load_f10()
    calc = master.load_calcparam()
    recon = master.reconcile_fees(f10, calc)

    # --- 主力重建 ---
    main, rolls = build_main_series(contracts)

    # --- 落盘 ---
    def dump(df: pd.DataFrame, name: str, key: str | None = None) -> None:
        path = (meta_dir if key == "meta" else clean_dir) / name
        df.to_csv(path, index=False, encoding="utf-8")
        OUTPUTS[name] = path
        manifest["outputs"][name] = {
            "rows": int(len(df)),
            "cols": list(df.columns),
            "sha256": _hash_file(path),
        }

    contract_cols = [
        "contract", "symbol", "month", "date",
        "open", "high", "low", "close", "settle", "settle_raw",
        "volume", "open_interest", "usable", "qc_suspect",
        "flag_dup_date", "flag_nonpos", "flag_ohlc", "flag_settle_zero",
        "flag_zero_vol", "flag_zero_oi", "flag_range", "flag_wick",
    ]
    dump(contracts[contract_cols], "contracts_clean.csv")
    dump(
        continuous[["series", "symbol", "date", "open", "high", "low", "close",
                     "settle", "settle_raw", "volume", "open_interest",
                     "usable", "qc_suspect", "flag_range", "flag_wick"]],
        "continuous_clean.csv",
    )
    dump(
        main[["symbol", "date", "contract", "open", "high", "low", "close",
              "settle", "volume", "open_interest", "prev_contract"]],
        "main_series.csv",
    )
    dump(rolls, "rolls.csv")
    dump(f10, "contract_master.csv", key="meta")
    dump(calc, "calcparam.csv", key="meta")
    dump(recon, "fee_reconciliation.csv", key="meta")

    # --- 质量摘要 ---
    quality = {
        "dataset": dataset,
        "source_dirs": [str(p) for p in (*raw_dirs, *con_dirs)],
        "calendar_days": int(len(calendar)),
        "calendar_start": str(calendar.min().date()),
        "calendar_end": str(calendar.max().date()),
        "contracts": clean.summary(contracts, "single-contracts", key="contract"),
        "continuous": clean.summary(continuous, "continuous", key="series"),
        "main_series": {
            "rows": int(len(main)),
            "symbols": int(main["symbol"].nunique()),
            "rolls": int(len(rolls)),
        },
        "missing_days_by_symbol": {
            s: int(len(clean.missing_days(g, calendar)))
            for s, g in contracts.groupby("symbol")
        },
        "fee_reconciliation": {
            "status_counts": recon["status"].value_counts().to_dict(),
            "mismatch_codes": sorted(recon.loc[recon["status"] != "match", "code"].tolist()),
        },
        "multiplier": {
            "missing": sorted(f10.loc[f10["multiplier"].isna(), "code"].tolist()),
            "unit_vs_dot_conflict": sorted(
                f10.loc[
                    f10["multiplier_dot"].notna()
                    & (f10["multiplier"] - f10["multiplier_dot"]).abs() > 1e-9,
                    "code",
                ].tolist()
            ),
        },
        "readme": "所有 flag_* 为质量标记；qc_suspect=True 表示至少命中一条可疑规则。",
    }
    qpath = meta_dir / "quality.json"
    qpath.write_text(json.dumps(quality, ensure_ascii=False, indent=1), encoding="utf-8")
    manifest["outputs"]["quality.json"] = {"sha256": _hash_file(qpath)}

    (meta_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    return quality


if __name__ == "__main__":
    q = run()
    print(json.dumps(q, ensure_ascii=False, indent=1))
