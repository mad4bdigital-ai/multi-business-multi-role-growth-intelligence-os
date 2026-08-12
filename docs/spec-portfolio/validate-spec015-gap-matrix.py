#!/usr/bin/env python3
import json
from pathlib import Path

path = Path(__file__).with_name("spec015-gap-matrix.generated.json")
data = json.loads(path.read_text(encoding="utf-8"))
assert data["task_count"] == sum(len(phase["tasks"]) for phase in data["phases"])
assert data["task_count"] == 57
assert data["phase_count"] == 8
assert data["runtime_completion_claim"] is False
assert data["safety"] == {
    "mutates_runtime": False,
    "marks_tasks_complete": False,
    "secrets_included": False,
}
for phase in data["phases"]:
    for task in phase["tasks"]:
        assert task["runtime_completion_claim"] is False
        assert task["task_id"].startswith("T")
print(json.dumps({
    "ok": True,
    "task_count": data["task_count"],
    "phase_count": data["phase_count"],
    "runtime_completion_claim": data["runtime_completion_claim"],
    "safety": data["safety"],
}, indent=2))
