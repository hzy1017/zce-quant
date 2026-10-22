"""构建清洗数据集。

用法（必须用带 pandas 的 Python）：
    python scripts\\build_dataset.py            # 审计快照 -> data/clean
    python scripts\\build_dataset.py live       # 快照+刷新 -> data/clean_live
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from zce import build  # noqa: E402

if __name__ == "__main__":
    dataset = sys.argv[1] if len(sys.argv) > 1 else "snapshot"
    q = build.run(dataset=dataset)
    print(f"[OK] 数据构建完成（dataset={dataset}）")
    print(json.dumps(q, ensure_ascii=False, indent=1)[:2000])
