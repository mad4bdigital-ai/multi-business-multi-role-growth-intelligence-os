#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

path = Path(__file__).with_name("spec015-candidate-pr-readonly-evidence-20260812.jsonl")
text = path.read_text(encoding="utf-8")
decoder = json.JSONDecoder()
rows = []
position = 0
while position < len(text):
    try:
        value, end = decoder.raw_decode(text, position)
    except json.JSONDecodeError:
        position += 1
        continue
    if isinstance(value, dict):
        rows.append(value)
    position = end

snapshot_bases = sorted({row.get("snapshotBaseMainSha") for row in rows})
summary = {
    "records": len(rows),
    "open": sum(row.get("state") == "OPEN" for row in rows),
    "closed": sum(row.get("state") in {"CLOSED", "MERGED"} for row in rows),
    "draft": sum(row.get("isDraft") is True for row in rows),
    "conflicting": sum(row.get("mergeable") == "CONFLICTING" for row in rows),
    "numbers": [row.get("number") for row in rows],
    "snapshot_base_main_shas": snapshot_bases,
    "safe_read_only": all(row.get("safe_read_only") is True for row in rows),
    "merge_executed": any(row.get("merge_executed") is True for row in rows),
    "secrets_included": any(row.get("secrets_included") is True for row in rows),
}
print(json.dumps(summary, indent=2))
