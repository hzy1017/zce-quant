"""全局配置：路径与常量。

可配置项（避免把本机路径写进仓库）：
1. 项目根：默认自动识别（本文件位于 <root>/src/zce/config.py），
   可用环境变量 `ZCE_ROOT` 覆盖。
2. 官方模拟终端：可用环境变量 `ZCE_TERMINAL_HOME` 指定，
   或在项目根放置 `config.local`（键=值，已加入 .gitignore）。

`config.local` 示例：
    ZCE_TERMINAL_HOME=D:\\path\\to\\Epolestar
    ZCE_ROOT=D:\\path\\to\\zce

原则：
1. 原始数据目录（raw/ contracts/）只读，所有输出写入 data/ 与 reports/。
2. 不硬编码任何账号、令牌或密钥。
"""
from __future__ import annotations

import os
from pathlib import Path

_LOCAL_FILE = "config.local"


def _read_local() -> dict[str, str]:
    """读取项目根下的 config.local（简单 键=值，不执行代码）。"""
    f = Path(__file__).resolve().parents[2] / _LOCAL_FILE
    out: dict[str, str] = {}
    if not f.exists():
        return out
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        out[key.strip()] = val.strip().strip('"').strip("'")
    return out


_LOCAL = _read_local()

# ---- 项目根 ----
_default_root = Path(__file__).resolve().parents[2]
ROOT = Path(os.environ.get("ZCE_ROOT") or _LOCAL.get("ZCE_ROOT") or _default_root)

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
# 通过环境变量 ZCE_TERMINAL_HOME 或 config.local 指定；未配置时相关功能会给出明确提示。
_terminal = os.environ.get("ZCE_TERMINAL_HOME") or _LOCAL.get("ZCE_TERMINAL_HOME") or ""
TERMINAL = Path(_terminal) if _terminal else Path()
F10_FILE = TERMINAL / "Server" / "config" / "BaseData" / "CspAccessApi.F10.pub"
COMMODITY_FILE = TERMINAL / "Server" / "config" / "BaseData" / "CspAccessApi.Commodity.pub"
CALCPARAM_FILE = TERMINAL / "Server" / "config" / "EsTrade.CalcParam.pri"


def terminal_configured() -> bool:
    """终端路径是否已配置（用于给出友好报错）。"""
    return bool(_terminal) and TERMINAL.exists()


def require_terminal() -> Path:
    """需要终端元数据时调用；未配置则抛出可读错误。"""
    if not _terminal:
        raise RuntimeError(
            "未配置官方模拟终端路径。请设置环境变量 ZCE_TERMINAL_HOME，"
            f"或在项目根创建 {_LOCAL_FILE} 写入：ZCE_TERMINAL_HOME=<终端安装目录>"
        )
    if not TERMINAL.exists():
        raise RuntimeError(f"终端路径不存在：{TERMINAL}")
    return TERMINAL

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
