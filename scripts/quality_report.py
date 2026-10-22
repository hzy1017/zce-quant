"""根据构建产物生成数据质量报告（Markdown）。

用法：
    python scripts\\quality_report.py          # 审计快照 -> reports/data_quality.md
    python scripts\\quality_report.py live     # 快照+刷新 -> reports/data_quality_live.md
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from zce import config  # noqa: E402


def main() -> None:
    dataset = sys.argv[1] if len(sys.argv) > 1 else "snapshot"
    meta = config.META_DIR if dataset == "snapshot" else config.META_LIVE_DIR
    clean = config.CLEAN_DIR if dataset == "snapshot" else config.CLEAN_LIVE_DIR
    out_name = "data_quality.md" if dataset == "snapshot" else "data_quality_live.md"

    q = json.loads((meta / "quality.json").read_text(encoding="utf-8"))
    recon = pd.read_csv(meta / "fee_reconciliation.csv")
    main_df = pd.read_csv(clean / "main_series.csv", parse_dates=["date"])
    rolls = pd.read_csv(clean / "rolls.csv")

    c, cont = q["contracts"], q["continuous"]
    L: list[str] = []
    A = L.append

    title = "数据质量报告（阶段三）" if dataset == "snapshot" else "数据质量报告（阶段三 · 刷新版）"
    A(f"# {title}")
    A("")
    A(f"- 数据集：`{dataset}`")
    A(f"- 数据截止 **{q['calendar_end']}**")
    A(f"- 目录：{', '.join('`' + p + '`' for p in q.get('source_dirs', []))}")
    A(f"- 参考交易日历：{q['calendar_start']} → {q['calendar_end']}，共 **{q['calendar_days']}** 个交易日")
    A("- 原始数据目录只读；本报告所有指标由 `scripts/build_dataset.py` 产物计算")
    A("")
    A("## 1. 数据集总览")
    A("")
    A("| 数据集 | 行数 | 起止 | 重复日期 | OHLC 违规 | 结算价=0 | 零成交 | 零持仓 | 振幅异常 | 影线异常 | 可疑行 |")
    A("|---|---|---|---|---|---|---|---|---|---|---|")
    for name, d in (("单合约", c), ("主力连续(raw)", cont)):
        A(f"| {name} | {d['rows']:,} | {d['start']} → {d['end']} | {d['dup_dates']} | "
          f"{d['ohlc_bad']} | {d['settle_zero']} | {d['zero_vol']} | {d['zero_oi']} | "
          f"{d['range_suspect']} | {d['wick_suspect']} | {d['suspect_rows']:,} |")
    A("")
    A(f"逐日真实主力序列：**{len(main_df):,}** 行，覆盖 {main_df['symbol'].nunique()} 个品种，"
      f"记录换月 **{len(rolls)}** 次。")
    A("")
    A("## 2. 关键结论")
    A("")
    A("1. 单合约数据干净：无重复日期、无 OHLC 逻辑违规、无零成交、无缺失收盘价。")
    A(f"2. 单合约存在 **{c['settle_zero']}** 行结算价为 0（源站缺值），已置为缺失而非填入 0。")
    A(f"3. **主力连续序列（raw）明显更脏**：{cont['ohlc_bad']} 行 OHLC 违规、"
      f"{cont['settle_zero']} 行结算价为 0、{cont['zero_vol']} 行零成交。"
      "结论：**回测不得直接使用 raw 连续序列的价格作为成交价**。")
    A(f"4. 单合约有 {c['range_suspect']} 根振幅 >11% 的 K 线、{c['wick_suspect']} 根下影线异常，"
      "其中一部分是真实涨跌停/事件日，另一部分是源站错误报价；已全部标记 `qc_suspect`，未删除。")
    A("")
    A("### 缺失交易日（相对参考日历）")
    A("")
    miss = {k: v for k, v in q["missing_days_by_symbol"].items() if v > 0}
    if miss:
        A("| 品种 | 缺失天数 |")
        A("|---|---|")
        for k, v in sorted(miss.items(), key=lambda x: -x[1]):
            A(f"| {k} | {v} |")
        A("")
        A("其余品种无缺失。新上市品种（PL/PR/PX/SH）缺失是上市前无数据所致，非数据缺陷。")
    else:
        A("无缺失。")
    A("")
    A("## 3. 合约主数据与费率对账")
    A("")
    counts = q["fee_reconciliation"]["status_counts"]
    A("| 状态 | 数量 | 含义 |")
    A("|---|---|---|")
    meanings = {
        "match": "终端计费 = F10 × 1.5，完全吻合",
        "constant_mismatch": "恒定但与 F10×1.5 不等",
        "month_varying": "随合约月/价格变化，不能压成单一元/手",
        "f10_fee_unknown": "F10 未给出可解析费率（按成交金额计费）",
        "no_calc_record": "终端无该品种计费记录",
    }
    for k, v in counts.items():
        A(f"| {k} | {v} | {meanings.get(k, '')} |")
    A("")
    A("**不一致品种**：" + "、".join(q["fee_reconciliation"]["mismatch_codes"]))
    A("")
    A("> 处理原则：回测成本以**终端逐合约计费参数**为准（这是模拟盘真实扣费口径）；"
      "F10 仅作交易所挂牌标准的参照。两者冲突时以终端为准，并在回测报告中声明。")
    A("")
    A("### 乘数校验")
    A("")
    A("- 乘数优先取自 `FUnit`（交易单位文本），缺失时回退 `FCommodityDot`。")
    A(f"- 已知冲突：{q['multiplier']['unit_vs_dot_conflict']}——`FCommodityDot` 给出 2.0，"
      "但交易单位为 5吨/手（与交易所一致），以交易单位为准。")
    A("")
    A("## 4. 可用范围与不可研究部分")
    A("")
    A("| 项目 | 可用范围 | 说明 |")
    A("|---|---|---|")
    A("| 日频期货行情 | 单合约 2021-01-18 起；主力连续 2005 起 | 仅日线，无分钟/tick |")
    A("| 期权行情 | **无** | 无行权价/权利金/IV/Greeks，期权策略不可研究 |")
    A("| 合约规格 | 27 个郑商所期货品种 | 乘数/最小变动/涨跌停/交易时间/最后交易日 |")
    A("| 费率 | 逐合约（终端口径） | 部分品种按成交金额计费，见 §3 |")
    A("| 保证金 | 逐合约逐月 | F10 与终端存在冲突，开仓当日以终端为准 |")
    A("| 账户与成交记录 | **无** | 需人工回填 |")
    A("")
    A("## 5. 复现方式")
    A("")
    A("```powershell")
    A("$py = \"C:\\Users\\17636\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe\"")
    A("& $py scripts\\refresh_data.py           # 可选：刷新到最新交易日")
    A("& $py scripts\\build_dataset.py [live]   # 构建，写入 data/ 或 data/clean_live")
    A("& $py scripts\\quality_report.py [live]  # 生成本报告")
    A("& $py tests\\test_pipeline.py            # 验收测试")
    A("```")
    A("")
    A(f"输出清单见 `{meta.as_posix()}/manifest.json`（含每个产物的 sha256）。")

    out = config.REPORT_DIR / out_name
    out.write_text("\n".join(L), encoding="utf-8")
    print(f"[OK] 已生成 {out}")


if __name__ == "__main__":
    main()
