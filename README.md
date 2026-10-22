# 郑商所杯量化项目（zce）

第九届“郑商所杯”大学生金融衍生品专业能力大赛 —— 本地研究系统。
**仅用于离线研究、回测与信号生成；不下单、不连接账户、不接触真实资金。**

## 当前阶段

- 阶段一：环境与数据审计 ✅
- 阶段二：规则与平台可行性核实 ✅（结论：无官方程序化接口，采用“研究 + 人工下单”）
- 阶段三：数据处理与合约管理 ✅
- 阶段四：回测引擎与基线策略 ✅（结论：无稳健优势，详见 `reports/backtest_report.md`）
- 阶段六：风险审核层 ✅
- 阶段八：信号卡 / 每日决策简报 ✅
- 阶段五 OOS 择优、阶段七 模拟盘接入：**未开展**（无通过验证的信号，且平台不提供程序化接口）

## 目录结构

```
zce/
├── raw/                  # 【只读】27 个品种主力连续日线（Sina JSONP）
├── contracts/            # 【只读】703 个单合约日线
├── raw_live/             # 刷新增量：27 个连续序列（覆盖快照同名文件）
├── contracts_live/       # 刷新增量：在交易合约（覆盖快照同名文件）
├── out/                  # 【只读】旧版 JS 研究项目产物
├── src/zce/              # 本项目代码
│   ├── config.py         # 路径、比赛常量、质量阈值
│   ├── jsdata.py         # JSONP 行情解析（支持多目录覆盖）
│   ├── master.py         # 合约主数据 + 费率对账
│   ├── clean.py          # 质量标记与清洗
│   ├── build.py          # 主流程（snapshot / live 两种数据集）
│   ├── backtest.py       # 日频回测引擎（真实合约、成本、保证金）
│   ├── risk.py           # 风险审核层（默认拒绝）
│   └── signal.py         # 信号卡 / 观望卡
├── scripts/
│   ├── refresh_data.py   # 入口：从 Sina 刷新最新日线
│   ├── build_dataset.py  # 入口：构建清洗数据集
│   ├── quality_report.py # 入口：生成数据质量报告
│   ├── run_baselines.py  # 入口：基线策略回测
│   ├── run_phase4b.py    # 低频动量 + 信号有效性诊断
│   ├── run_phase4c.py    # 期限结构（carry）策略
│   └── daily_brief.py    # 入口：每日决策简报 + 信号卡
├── tests/
│   ├── test_pipeline.py  # 数据管线验收（31 项）
│   ├── test_backtest.py  # 引擎验收（9 项，含未来数据隔离）
│   └── test_risk.py      # 风控验收（23 项）
├── data/clean/           # 快照产物（可重建）
├── data/clean_live/      # 快照+刷新产物（可重建）
├── data/meta/            # 主数据、对账、质量摘要、manifest
└── reports/              # 数据质量报告
```

## 环境与依赖

需要一个带 pandas / numpy 的 Python 3.12 解释器。下文用 `python` 代指该解释器，
请自行替换为实际路径（例如虚拟环境中的 `\.venv\Scripts\python.exe`）。

| 依赖 | 版本 | 用途 |
|---|---|---|
| Python | 3.12 | 运行时 |
| pandas | 3.0 | 数据处理 |
| numpy | 2.3 | 数值计算 |
| python-docx | 1.2 | 生成 Word 报告（可选） |

```powershell
python -m pip install pandas numpy python-docx
```

原始数据由新浪接口缓存为 `.js` 文件，本模块只读不下载。

## 配置（本机路径不进仓库）

项目根目录**自动识别**（`src/zce/config.py` 的上两级），无需配置。

官方模拟终端路径（用于读取合约规格与费率）不会提交到仓库，需在本机指定其一：

**方式一：环境变量**

```powershell
$env:ZCE_TERMINAL_HOME = "D:\path\to\Epolestar"    # 终端安装目录
```

**方式二：项目根下新建 `config.local`**（已在 .gitignore 中，不会提交）

```
ZCE_TERMINAL_HOME=D:\path\to\Epolestar
```

未配置时，凡是需要合约元数据的功能都会抛出明确提示，而不会静默失败。
仅使用行情与回测（`build_dataset.py`、`run_phase4c.py` 的行情部分）时可以不配置。

## 运行

```powershell
cd <项目根>
python -m pip install pandas numpy

# 1) 可选：刷新到最新交易日（写入 raw_live/ contracts_live/，不动快照）
python scripts\refresh_data.py

# 2) 构建（snapshot = 审计快照；live = 快照+刷新覆盖）
python scripts\build_dataset.py          # → data/clean,  data/meta
python scripts\build_dataset.py live     # → data/clean_live, data/meta_live

# 3) 报告与测试
python scripts\quality_report.py [live]
python tests\test_pipeline.py            # 31 项，基于快照
```

构建是**幂等**的：两次运行产物 sha256 一致（测试 [6] 已验证）。
刷新只覆盖“还会变”的文件：27 个连续序列 + 未到期合约（约 170 个），
未挂牌远月拉取失败属正常，记录在 `data/meta/refresh_manifest.json`。

## 关键数据约定

1. **原始数据永不修改**；清洗结果写入 `data/`，可随时重建。
2. **价格为元/吨，成交量与持仓量为手**；`settle` 缺失（源站为 0）置为 NaN，不插值。
3. **`usable`** 表示价格逻辑可用；**`qc_suspect`** 表示命中可疑规则（振幅/影线）。
   两者独立：涨跌停等真实大波动也会被标记，但不应因此删除。
4. **回测禁止使用 `continuous_clean.csv` 的价格作为成交价**。
   该连续序列存在拼接跳空（实测 SR 有 202 天与真实主力合约价格不同，换月日最大差 347 元）。
   正确做法：使用 `main_series.csv`（逐日真实主力合约）或直接使用单合约价格并处理换月。
5. **费率口径**：以终端逐合约计费参数为准（`data/meta/calcparam.csv`），
   它已含比赛规定的 1.5 倍；`contract_master.csv` 中的交易所挂牌标准仅作参照。
   两者在 16 个品种上不一致，详见 `reports/data_quality.md` §3。

## 回测引擎

`src/zce/backtest.py` 的硬性约定：

| 项目 | 处理方式 |
|---|---|
| 成交时点 | t 日收盘出信号 → **t+1 日开盘**成交（测试用截断重算验证无未来数据） |
| 价格 | 使用**真实合约**价格结算盈亏，不做价格复权 |
| 换月 | 换月当日盈亏归零，另计“平旧+开新”往返手续费与滑点 |
| 成本 | 终端逐合约手续费（已含 1.5 倍）+ 滑点（默认 1 跳） |
| 约束 | 整数手、保证金 ≤ 权益 80%、封板(H==L)与零成交不成交 |
| 仓位 | 波动率目标（`vol`）或等权（`equal`，用于基准） |

运行：

```powershell
& $py scripts\run_baselines.py     # → reports/backtest_report.md, data/backtest/
& $py tests\test_backtest.py       # 9 项：未来数据隔离、成本单调、约束、确定性
```

**已实测结论（2021-01 ~ 2026-10）**：时序动量 TSMOM 在样本内外均亏损且对回看窗口极度敏感；
横截面动量 XS-MOM 小幅正收益（IS +5.0% / OOS +2.5%）但优势很弱；
等权做多基准 OOS 为 -2.3%，说明该时段郑商所商品整体没有单边上涨。
**不构成可交易优势的证据。**

## 风险审核层（阶段六）

`src/zce/risk.py` 是策略与执行之间的独立闸门，**默认拒绝**。规则（建议值，待确认）：

| 参数 | 取值 | 含义 |
|---|---|---|
| `max_risk_per_trade` | 0.5% | 单笔最大亏损（按计划止损价计算） |
| `max_notional_per_symbol` | 30% | 单品种名义敞口上限 |
| `max_total_margin` | 60% | 组合保证金占用上限 |
| `max_positions` | 5 | 同时持仓品种数上限 |
| `max_drawdown_halt` | 8% | 回撤熔断，停止开新仓 |
| `max_consecutive_losses` | 3 | 连亏 3 笔后仓位减半 |
| `min_open_interest` / `min_volume` | 10,000 / 1,000 | 流动性门槛 |

每次审核返回**通过/拒绝 + 计算过程 + 拒绝理由**，全部可复核。
注意：止损是计划价，**不保证按该价成交**，模块不假设止损一定能执行。

## 每日决策简报

```powershell
& $py scripts\daily_brief.py SR CF TA     # → reports/daily_brief.md
```

输出风险预算、主力合约快照与信号卡。当前项目状态是**观望**：
三类信号均未通过验证，因此不生成开仓指令。

## 已知限制

- 无期权行情（无行权价/权利金/IV/Greeks），期权策略不可研究。
- 无分钟/tick 数据，只能做日频策略，无法建模真实滑点。
- 无账户与成交记录，需人工回填后复盘。
- 快照数据截止 2026-09-24；刷新版（`live`）截止 **2026-10-21**。
  每次做当前信号前都应先运行 `refresh_data.py`。

## 合规声明

本项目遵守比赛规则：只使用官方模拟账户，不进行程序化下单。
所有信号由离线系统生成，经风险审核后由人工在终端执行。
