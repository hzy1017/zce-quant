"""全局配置：路径与常量。

原则：
1. 原始数据目录（raw/ contracts/）只读，本模块所有输出写入 data/ 与 reports/。
2. 不硬编码任何账号、令牌或密钥。
"""
from __future__ import annotations

from pathlib import Path

# ---- 项目根 ----
ROOT = Path(r"D:\ai tools\zce")

RAW_DIR = ROOT / "raw"                 # 27 个品种主力连续（Sina JSONP，审计快照）
CONTRACT_DIR = ROOT / "contracts"      # 703 个单合约（Sina JSONP，审计快照）
LEGACY_OUT = ROOT / "out"              # 旧版 JS 项目产物，只读

# 增量刷新目录（覆盖快照中的同名文件；快照本身保持不变）
LIVE_RAW_DIR = ROOT / "raw_live"
LIVE_CONTRACT_DIR = ROOT / "contracts_live"

DATA_DIR = ROOT / "data"
CLEAN_DIR = DATA_DIR / "clean"
META_DIR = DATA_DIR / "meta"
CLEAN_LIVE_DIR = DATA_DIR / "clean_live"
META_LIVE_DIR = DATA_DIR / "meta_live"
REPORT_DIR = ROOT / "reports"
LOG_DIR = ROOT / "logs"

# ---- 官方模拟终端（合约与费率元数据来源，只读）----
TERMINAL = Path(r"D:\study\期货\Epolestar000450v9.5")
F10_FILE = TERMINAL / "Server" / "config" / "BaseData" / "CspAccessApi.F10.pub"
COMMODITY_FILE = TERMINAL / "Server" / "config" / "BaseData" / "CspAccessApi.Commodity.pub"
CALCPARAM_FILE = TERMINAL / "Server" / "config" / "EsTrade.CalcParam.pri"

# ---- 比赛规则常量（见阶段二报告，来源：郑商函〔2026〕670号）----
CONTEST_INITIAL_EQUITY = 500_000.0     # 初始虚拟保证金
CONTEST_FEE_MULTIPLIER = 1.5           # 手续费 = 交易所标准 × 1.5

# ---- 数据质量阈值（保守，宁可标疑不可删）----
RANGE_SUSPECT = 0.11      # 日内振幅 (H-L)/C 超过 11% 标记可疑
WICK_SUSPECT = 0.045      # 下影线低于 min(O,C) 超过 4.5% 标记可疑
MIN_VOLUME = 1            # 成交量为 0 视为不可成交

# 已停止/极低流动性品种：不进入可交易池
DEAD_SYMBOLS = {"ZC", "PM", "WH", "JR", "LR", "RI"}

# 交易时段（来自终端 F10.pub 的 FTradingTime 字段）
DAY_SESSIONS = ("09:00-10:15", "10:30-11:30", "13:30-15:00")
NIGHT_SESSION = "21:00-23:00"


def ensure_dirs() -> None:
    for d in (DATA_DIR, CLEAN_DIR, META_DIR, CLEAN_LIVE_DIR, META_LIVE_DIR,
              REPORT_DIR, LOG_DIR):
        d.mkdir(parents=True, exist_ok=True)
