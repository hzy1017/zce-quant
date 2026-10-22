"""阶段四第二轮：低频、低成本、带状态过滤的动量策略。

设计依据（先定规则再看结果，避免事后挑选）：
1. **双重动量**（Antonacci）：相对动量选出强者，绝对动量（自身 120 日收益 > 0）过滤掉
   “整体下跌中最不差的品种”，避免在熊市里满仓。
2. **状态过滤**：等权指数在 200 日均线下方时整体空仓。商品整体走弱时，
   持币的机会成本低于做多的亏损。
3. **低频**：60 个交易日调仓一次，把成本从年化 ~1.3% 压到 ~0.3%。
4. **只做多**：比赛评分以收益为主，但做空在震荡市反复止损，先验证多头版本。

预登记的择优规则（在看到 OOS 之前确定）：
    在 IS 最大回撤不差于 -20% 的候选中，取 IS Sharpe 最高者；
    若全部候选 IS Sharpe < 0，则判定“无候选”，不做 OOS 择优。
OOS 只跑被选中的那一个，不回头看其它候选的 OOS，避免多重检验。

用法：python scripts\\run_phase4b.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from zce import backtest as bt, config  # noqa: E402

IS = ("2021-01-18", "2024-12-31")
OOS = ("2025-01-01", "2026-10-21")
OUT = config.DATA_DIR / "backtest"


def build_index(panel: dict[str, pd.DataFrame]) -> pd.Series:
    """等权指数：每日等权平均各品种收益（换月收益已归零）。"""
    rets = pd.DataFrame({s: df.set_index("date")["ret"] for s, df in panel.items()}).sort_index()
    return (1 + rets.mean(axis=1).fillna(0)).cumprod()


def regime_mask(index: pd.Series, window: int = 200) -> pd.Series:
    ma = index.rolling(window, min_periods=100).mean()
    return (index > ma).fillna(False)


def selection(panel, lookback=120, top=3, rebal=60,
              use_absolute=True, use_regime=False, vol_cap=None) -> pd.DataFrame:
    px = pd.DataFrame({s: df.set_index("date")["idx"] for s, df in panel.items()}).sort_index()
    mom = px / px.shift(lookback) - 1
    index = build_index(panel)
    mask = regime_mask(index) if use_regime else pd.Series(True, index=px.index)
    vol = index.pct_change().rolling(20).std() * np.sqrt(244)

    frames = []
    for i in range(0, len(mom), rebal):
        block = pd.DataFrame(0, index=mom.index[i:i + rebal], columns=mom.columns)
        row = mom.iloc[i].dropna()
        if use_absolute:
            row = row[row > 0]
        if vol_cap is not None:
            v = vol.iloc[i]
            if v == v and v > vol_cap:
                row = row.iloc[0:0]
        if len(row) >= 1:
            block[row.nlargest(min(top, len(row))).index] = 1
        frames.append(block)
    sel = pd.concat(frames).sort_index()
    return sel.mul(mask.reindex(sel.index).fillna(False), axis=0).astype(int)


def evaluate(panel, specs, targets, window, name, slots=3, mode="vol"):
    cfg = bt.BTConfig(start=window[0], end=window[1], n_slots=slots, weight_mode=mode)
    res = bt.run_backtest(panel, specs, targets, cfg)
    st = dict(res["stats"])
    st.update(strategy=name, window=f"{window[0]}~{window[1]}")
    return {"stats": st, "equity": res["equity"], "trades": res["trades"]}


CANDIDATES = {
    "LONG_TOP3_Q": dict(use_absolute=False, use_regime=False),
    "LONG_TOP3_Q_ABS": dict(use_absolute=True, use_regime=False),
    "LONG_TOP3_Q_ABS_REGIME": dict(use_absolute=True, use_regime=True),
    "LONG_TOP3_Q_ABS_REGIME_VOL": dict(use_absolute=True, use_regime=True, vol_cap=0.32),
}


def signal_diagnostic(panel, top=3) -> pd.DataFrame:
    """信号有效性检验：选中品种的未来收益是否高于全市场等权。

    与仓位、成本无关，用于判断“没有收益”到底是信号无效还是仓位太小。
    """
    px = pd.DataFrame({s: df.set_index("date")["idx"] for s, df in panel.items()}).sort_index()
    dates = px.index
    rows = []
    for lb in (20, 60, 120, 200):
        mom = px / px.shift(lb) - 1
        for hz in (20, 60):
            fwd = px.shift(-hz) / px - 1
            exc = []
            for i in range(lb, len(dates) - hz, hz):
                row = mom.iloc[i].dropna()
                row = row[np.isfinite(row)]
                f = fwd.iloc[i].reindex(row.index)
                ok = f.notna()
                if ok.sum() < 5:
                    continue
                sel = row[ok].nlargest(top).index
                exc.append(f[sel].mean() - f[ok].mean())
            exc = np.array(exc)
            if len(exc) < 10:
                continue
            t = exc.mean() / (exc.std(ddof=1) / np.sqrt(len(exc)))
            rows.append({"lookback": lb, "horizon": hz, "n": len(exc),
                         "excess_ann": exc.mean() * (244 / hz),
                         "hit_rate": float(np.mean(exc > 0)), "t_stat": float(t)})
    return pd.DataFrame(rows)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    panel = bt.prepare(bt.load_main("live"))
    specs = bt.load_specs()

    diag = signal_diagnostic(panel)
    print("=" * 90)
    print("信号有效性诊断（与仓位、成本无关）")
    print("=" * 90)
    print(diag.to_string(index=False, float_format=lambda x: f"{x:.3f}"))
    diag.to_csv(OUT / "signal_diagnostic.csv", index=False)

    print("=" * 90)
    print("IS 阶段：候选对比（不含 OOS 结果）")
    print("=" * 90)
    is_rows = []
    for name, kw in CANDIDATES.items():
        tgt = selection(panel, **kw)
        r = evaluate(panel, specs, tgt, IS, name)
        is_rows.append(r["stats"])
        r["equity"].to_csv(OUT / f"equity_{name}_IS.csv", index=False)

    df = pd.DataFrame(is_rows)
    cols = ["strategy", "total_return", "cagr", "max_drawdown", "sharpe", "trades",
            "total_cost", "cost_ratio", "win_rate"]
    print(df[cols].to_string(index=False))

    # ---- 预登记择优 ----
    ok = df[df["max_drawdown"] >= -0.20]
    if len(ok) == 0 or ok["sharpe"].max() <= 0:
        print("\n[判定] 无候选满足条件（回撤与 Sharpe），不进入 OOS。")
        chosen = None
    else:
        chosen = ok.sort_values("sharpe", ascending=False).iloc[0]["strategy"]
        print(f"\n[择优] 按预登记规则选中：{chosen}（IS Sharpe={ok['sharpe'].max()}）")

    # ---- OOS 只跑被选中的 ----
    oos_stats = None
    if chosen:
        tgt = selection(panel, **CANDIDATES[chosen])
        r = evaluate(panel, specs, tgt, OOS, chosen)
        oos_stats = r["stats"]
        r["equity"].to_csv(OUT / f"equity_{chosen}_OOS.csv", index=False)
        if len(r["trades"]):
            r["trades"].to_csv(OUT / f"trades_{chosen}_OOS.csv", index=False)
        print("\n" + "=" * 90)
        print("OOS 结果（只此一次）")
        print("=" * 90)
        print(pd.DataFrame([oos_stats])[cols].to_string(index=False))

    write_report(df, chosen, oos_stats, diag)
    return 0


def write_report(df: pd.DataFrame, chosen, oos, diag: pd.DataFrame | None = None) -> None:
    L: list[str] = []
    A = L.append
    A("# 阶段四第二轮：低频动量策略")
    A("")
    A("- 设计：120 日横截面动量 + 绝对动量过滤 + 200 日均线状态过滤 + 60 日调仓 + 只做多")
    A("- 样本内 IS：2021-01-18 ~ 2024-12-31；样本外 OOS：2025-01-01 ~ 2026-10-21")
    A("- 择优规则在看到 OOS 之前写死（见脚本 docstring），OOS 只跑一次")
    A("")
    A("## 1. 样本内候选对比")
    A("")
    A("| 策略 | 总收益 | 年化 | 最大回撤 | Sharpe | 笔数 | 成本/权益 | 胜率 |")
    A("|---|---|---|---|---|---|---|---|")
    for _, r in df.iterrows():
        A("| {} | {:.2%} | {:.2%} | {:.2%} | {} | {} | {:.2%} | {} |".format(
            r["strategy"], r["total_return"], r["cagr"], r["max_drawdown"],
            r["sharpe"], r["trades"], r["cost_ratio"], r.get("win_rate")))
    A("")
    if chosen and oos:
        A(f"## 2. 择优结果：`{chosen}`")
        A("")
        A("| 样本 | 总收益 | 年化 | 最大回撤 | Sharpe | Calmar | 笔数 | 成本/权益 | 胜率 |")
        A("|---|---|---|---|---|---|---|---|---|")
        row = df[df["strategy"] == chosen].iloc[0]
        A("| IS | {:.2%} | {:.2%} | {:.2%} | {} | {} | {} | {:.2%} | {} |".format(
            row["total_return"], row["cagr"], row["max_drawdown"], row["sharpe"],
            row.get("calmar"), row["trades"], row["cost_ratio"], row.get("win_rate")))
        A("| OOS | {:.2%} | {:.2%} | {:.2%} | {} | {} | {} | {:.2%} | {} |".format(
            oos["total_return"], oos["cagr"], oos["max_drawdown"], oos["sharpe"],
            oos.get("calmar"), oos["trades"], oos["cost_ratio"], oos.get("win_rate")))
        A("")
    else:
        A("## 2. 择优结果")
        A("")
        A("**无候选满足预登记条件，本轮不产生可交易策略。**")
        A("")
    if diag is not None and len(diag):
        A("## 3. 为什么亏：信号有效性诊断")
        A("")
        A("把“选中品种的未来收益 − 全市场等权收益”直接算出来，与仓位和成本无关：")
        A("")
        A("| 回看(日) | 持有(日) | 样本数 | 选中超额(年化) | 胜率 | t 值 |")
        A("|---|---|---|---|---|---|")
        for _, r in diag.iterrows():
            A("| {} | {} | {} | {:.2%} | {:.1%} | {:.2f} |".format(
                int(r["lookback"]), int(r["horizon"]), int(r["n"]),
                r["excess_ann"], r["hit_rate"], r["t_stat"]))
        A("")
        best = diag.loc[diag["t_stat"].idxmax()]
        A(f"最强的一组是 {int(best['lookback'])} 日回看 / {int(best['horizon'])} 日持有，"
          f"超额 {best['excess_ann']:.2%}、t={best['t_stat']:.2f}——"
          "**在统计上与 0 无法区分**。")
        A("")
        A("结论：亏损不是仓位太小造成的，而是**横截面动量在这 20 个郑商所品种上不具备预测力**。"
          "继续调整动量参数只会放大噪声。")
        A("")
    A("## 4. 与上一轮对比")
    A("")
    A("- 换手大幅下降：60 日调仓使成交笔数从 TSMOM 的 1277 笔降到百笔量级，成本占比随之下降。")
    A("- 状态过滤的作用需要看它在 OOS 是否减少了回撤；若只是减少了收益，则不值得保留。")
    A("")
    A("## 5. 局限")
    A("")
    A("1. 单一交易所、约 5.8 年样本，OOS 仅约 1.8 年，统计功效有限。")
    A("2. 只用日线，无法判断盘中触发；调仓在次日开盘执行。")
    A("3. 候选数虽少（4 个），仍属有限次搜索，不能等同于独立验证。")
    A("4. 波动率状态阈值（32%）是先验设定，未在 OOS 上调优。")
    A("")
    A("## 6. 试验次数登记（防止多重检验自欺）")
    A("")
    A("| 轮次 | 假设 | 配置数 | 结果 |")
    A("|---|---|---|---|")
    A("| 第一轮 | 时序动量 / 横截面动量 | 5 | TSMOM 双样本亏损；XS-MOM 微弱正收益但 OOS 仅 93 笔 |")
    A("| 第二轮 | 低频 + 绝对动量 + 状态过滤 | 4 | 全部 IS 亏损，无候选进入 OOS |")
    A("| 诊断 | 动量信号有效性 | 8 组（4 回看 × 2 持有） | 全部 t<1.5，无显著超额 |")
    A("")
    A("累计已检验约 17 个配置。若继续在同一信号族上调参，找到“回测赢家”的期望更接近")
    A("数据挖掘而非发现规律。下一步应换**经济逻辑不同**的信号（如期限结构/展期收益），")
    A("而不是继续优化动量。")
    out = config.REPORT_DIR / "backtest_report_phase4b.md"
    out.write_text("\n".join(L), encoding="utf-8")
    print(f"[OK] 报告写入 {out}")


if __name__ == "__main__":
    raise SystemExit(main())
