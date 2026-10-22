"""阶段四第三轮：期限结构（carry）策略。

预登记规则（在运行前确定）：
  C1 只做多：每 20 日调仓，取 carry 最高的 3 个且 carry>0 的品种。
  C2 多空：同时做多最高 3 个、做空最低 3 个。
  先用 IS 检验；只有当某候选 IS Sharpe ≥ 0.5 且最大回撤不差于 -20% 时，
  才对其中最优者跑一次 OOS（`--oos`）。否则不进入 OOS。

用法：
    python scripts\\run_phase4c.py          # 仅 IS
    python scripts\\run_phase4c.py --oos    # IS + 对最优候选跑一次 OOS
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from zce import backtest as bt, carry, config  # noqa: E402

IS = ("2021-01-18", "2024-12-31")
OOS = ("2025-01-01", "2026-10-21")
OUT = config.DATA_DIR / "backtest"


def carry_targets(cm: pd.DataFrame, rebal=20, top=3, long_only=True) -> pd.DataFrame:
    frames = []
    for i in range(0, len(cm), rebal):
        block = pd.DataFrame(0, index=cm.index[i:i + rebal], columns=cm.columns)
        row = cm.iloc[i].dropna()
        row = row[row > 0]
        if len(row) >= 1:
            longs = row.nlargest(min(top, len(row))).index
            block.loc[:, longs] = 1
            if not long_only:
                neg = cm.iloc[i].dropna()
                neg = neg[neg < 0]
                if len(neg) >= 1:
                    shorts = neg.nsmallest(min(top, len(neg))).index
                    block.loc[:, shorts] = -1
        frames.append(block)
    return pd.concat(frames).sort_index().astype(int)


def carry_diagnostic(cm: pd.DataFrame, panel: dict, top=3) -> pd.DataFrame:
    """carry 是否预测未来收益：高 carry 组 − 全市场等权的未来收益。"""
    px = pd.DataFrame({s: df.set_index("date")["idx"] for s, df in panel.items()}).sort_index()
    common = cm.index.intersection(px.index)
    cm = cm.loc[common]
    px = px.loc[common]
    rows = []
    for hz in (20, 60):
        fwd = px.shift(-hz) / px - 1
        exc = []
        for i in range(0, len(cm) - hz, 20):
            row = cm.iloc[i].dropna()
            row = row[row > 0]
            f = fwd.iloc[i].reindex(row.index).dropna()
            if len(f) < 5:
                continue
            sel = [s for s in row.nlargest(top).index if s in f.index]
            if not sel:
                continue
            exc.append(f[sel].mean() - f.mean())
        if len(exc) < 10:
            continue
        e = np.array(exc)
        t = e.mean() / (e.std(ddof=1) / np.sqrt(len(e)))
        rows.append({"horizon": hz, "n": len(e), "excess_ann": e.mean() * (244 / hz),
                     "hit_rate": float(np.mean(e > 0)), "t_stat": float(t)})
    return pd.DataFrame(rows)


def evaluate(panel, specs, targets, window, name, slots=3, mode="vol"):
    cfg = bt.BTConfig(start=window[0], end=window[1], n_slots=slots, weight_mode=mode)
    res = bt.run_backtest(panel, specs, targets, cfg)
    st = dict(res["stats"])
    st.update(strategy=name, window=f"{window[0]}~{window[1]}")
    return {"stats": st, "equity": res["equity"], "trades": res["trades"]}


def main() -> int:
    do_oos = "--oos" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)

    contracts = carry.load_contracts("live")
    pair = carry.build_curve(contracts)
    cm = carry.carry_matrix(pair)
    print(f"期限结构配对：{len(pair):,} 条，覆盖 {cm.shape[1]} 品种，{cm.shape[0]} 个交易日")
    print(f"时间范围 {cm.index.min().date()} ~ {cm.index.max().date()}")
    print("\ncarry 分布（年化）：")
    print(cm.stack().describe(percentiles=[0.1, 0.5, 0.9]).round(3).to_string())
    pair.to_csv(OUT / "carry_pairs_sample.csv", index=False,
                header=True, encoding="utf-8", chunksize=200000)

    panel = bt.prepare(bt.load_main("live"))
    specs = bt.load_specs()

    diag = carry_diagnostic(cm, panel)
    print("\n信号有效性诊断（高 carry 组 − 全市场等权）")
    print(diag.to_string(index=False, float_format=lambda x: f"{x:.3f}"))
    diag.to_csv(OUT / "carry_diagnostic.csv", index=False)

    print("\n" + "=" * 90)
    print("IS 候选对比")
    print("=" * 90)
    cands = {
        "CARRY_LONG3": dict(long_only=True),
        "CARRY_LS_3v3": dict(long_only=False),
    }
    rows = []
    for name, kw in cands.items():
        tgt = carry_targets(cm, **kw)
        r = evaluate(panel, specs, tgt, IS, name)
        rows.append(r["stats"])
        r["equity"].to_csv(OUT / f"equity_{name}_IS.csv", index=False)
    df = pd.DataFrame(rows)
    cols = ["strategy", "total_return", "cagr", "max_drawdown", "sharpe", "trades",
            "total_cost", "cost_ratio", "win_rate"]
    print(df[cols].to_string(index=False))

    ok = df[(df["max_drawdown"] >= -0.20) & (df["sharpe"] >= 0.5)]
    chosen = None
    if len(ok):
        chosen = ok.sort_values("sharpe", ascending=False).iloc[0]["strategy"]
        print(f"\n[择优] {chosen} 满足预登记条件（IS Sharpe≥0.5 且回撤≥-20%）")
    else:
        print("\n[判定] 无候选满足预登记条件，不进入 OOS。")

    oos_stats = None
    if chosen and do_oos:
        r = evaluate(panel, specs, carry_targets(cm, **cands[chosen]), OOS, chosen)
        oos_stats = r["stats"]
        r["equity"].to_csv(OUT / f"equity_{chosen}_OOS.csv", index=False)
        print("\nOOS 结果（只此一次）：")
        print(pd.DataFrame([oos_stats])[cols].to_string(index=False))

    write_report(df, diag, chosen, oos_stats)
    return 0


def write_report(df, diag, chosen, oos) -> None:
    L: list[str] = []
    A = L.append
    A("# 阶段四第三轮：期限结构（carry）策略")
    A("")
    A("- 因子：`carry = (P近 − P远) / P远 × 12/Δ月`，年化展期收益")
    A("- 数据：`data/clean_live` 全部单合约，按日配对近月/次近月（要求两腿持仓 ≥ 1000 手）")
    A("- 样本内 IS：2021-01-18 ~ 2024-12-31；样本外 OOS：2025-01-01 ~ 2026-10-21（仅 `--oos`）")
    A("")
    A("## 1. 信号有效性诊断")
    A("")
    A("| 持有期(日) | 样本数 | 高 carry 组超额(年化) | 胜率 | t 值 |")
    A("|---|---|---|---|---|")
    for _, r in diag.iterrows():
        A("| {} | {} | {:.2%} | {:.1%} | {:.2f} |".format(
            int(r["horizon"]), int(r["n"]), r["excess_ann"], r["hit_rate"], r["t_stat"]))
    A("")
    A("## 2. 样本内候选")
    A("")
    A("| 策略 | 总收益 | 年化 | 最大回撤 | Sharpe | 笔数 | 成本/权益 | 胜率 |")
    A("|---|---|---|---|---|---|---|---|")
    for _, r in df.iterrows():
        A("| {} | {:.2%} | {:.2%} | {:.2%} | {} | {} | {:.2%} | {} |".format(
            r["strategy"], r["total_return"], r["cagr"], r["max_drawdown"],
            r["sharpe"], r["trades"], r["cost_ratio"], r.get("win_rate")))
    A("")
    if chosen and oos:
        A(f"## 3. 择优：`{chosen}`（含 OOS）")
        A("")
        A("| 样本 | 总收益 | 年化 | 最大回撤 | Sharpe | 笔数 | 成本/权益 |")
        A("|---|---|---|---|---|---|---|")
        row = df[df["strategy"] == chosen].iloc[0]
        for tag, s in (("IS", row), ("OOS", oos)):
            A("| {} | {:.2%} | {:.2%} | {:.2%} | {} | {} | {:.2%} |".format(
                tag, s["total_return"], s["cagr"], s["max_drawdown"], s["sharpe"],
                s["trades"], s["cost_ratio"]))
        A("")
    else:
        A("## 3. 择优结果")
        A("")
        A("**无候选满足预登记条件，本轮不进入 OOS。**" if not chosen
          else f"**{chosen} 满足条件，但本次未启用 `--oos`。**")
        A("")
    A("## 4. 局限")
    A("")
    A("1. 月份差按自然月近似（30.44 天/月），未按真实到期日折算。")
    A("2. 只取最近两个月份，未使用完整曲线；近月可能流动性不足。")
    A("3. 交易仍发生在主力合约上，carry 与主力持仓之间存在期限错配。")
    A("4. 单交易所、约 5.8 年样本，OOS 约 1.8 年。")
    out = config.REPORT_DIR / "backtest_report_phase4c.md"
    out.write_text("\n".join(L), encoding="utf-8")
    print(f"[OK] 报告写入 {out}")


if __name__ == "__main__":
    raise SystemExit(main())
