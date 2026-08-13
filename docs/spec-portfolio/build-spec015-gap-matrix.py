#!/usr/bin/env python3
"""Build a deterministic, source-path-based Spec 015 gap matrix.

This is an evidence collector only. It never marks a runtime task complete;
it reports adjacent source candidates and focused tests for human review.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from datetime import datetime, timezone

TASK_RE = re.compile(r"^- \[([ xX])\] (T\d+) (.+)$")

CATEGORIES = {
    "foundation": {
        "tasks": ["T010", "T011", "T012", "T013", "T014", "T015", "T016", "T017", "T018"],
        "patterns": ["package", "component", "plugin", "resource", "authority", "recipe"],
    },
    "compiler": {
        "tasks": ["T020", "T021", "T022", "T023", "T024", "T025", "T026", "T027"],
        "patterns": ["install", "activation", "lifecycle", "override", "context", "readiness", "revision"],
    },
    "entities_lifecycle": {
        "tasks": ["T030", "T031", "T032", "T033", "T034", "T035", "T036"],
        "patterns": ["entity", "relationship", "lifecycle", "schema", "migration", "approval", "timer"],
    },
    "forms_files": {
        "tasks": ["T040", "T041", "T042", "T043", "T044", "T045"],
        "patterns": ["form", "survey", "file", "folder", "client", "submission", "receipt"],
    },
    "ai_ui_reports": {
        "tasks": ["T050", "T051", "T052", "T053", "T054", "T055", "T056"],
        "patterns": ["agent", "surface", "report", "prompt", "frontend", "dispatch", "capability"],
    },
    "publication_lifecycle": {
        "tasks": ["T060", "T061", "T062", "T063", "T064", "T065", "T066"],
        "patterns": ["publication", "activation", "lifecycle", "upgrade", "rollback", "archive", "retire"],
    },
    "agency_client": {
        "tasks": ["T070", "T071", "T072", "T073", "T074", "T075", "T076"],
        "patterns": ["agency", "delegation", "handover", "ownership", "portfolio", "revocation", "export"],
    },
    "candidate_convergence": {
        "tasks": ["T080", "T081", "T082", "T083", "T084", "T085"],
        "patterns": ["3922", "4432", "4386", "2385", "tool", "evidence", "catalog", "external"],
    },
}


def load_tasks(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        match = TASK_RE.match(line.strip())
        if match:
            done, task_id, title = match.groups()
            rows.append({"task_id": task_id, "title": title, "spec_checked": done.lower() == "x"})
    return rows


def candidates(root: Path, patterns: list[str], limit: int = 24) -> list[str]:
    hits = []
    for directory in (root / "http-generic-api", root / "specs", root / "docs", root / ".changes", root / ".github"):
        if not directory.exists():
            continue
        for path in directory.rglob("*"):
            if not path.is_file() or "node_modules" in path.parts:
                continue
            name = path.name.lower()
            if any(pattern.lower() in name for pattern in patterns):
                hits.append(str(path.relative_to(root)))
    return sorted(set(hits))[:limit]


def tests(root: Path, patterns: list[str], limit: int = 18) -> list[str]:
    test_root = root / "http-generic-api"
    hits = []
    for path in test_root.glob("test-*.mjs"):
        haystack = path.name.lower()
        if any(pattern.lower() in haystack for pattern in patterns):
            hits.append(str(path.relative_to(root)))
    return sorted(set(hits))[:limit]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    root = args.root.resolve()
    tasks = load_tasks(root / "specs/015-tenant-operating-system-studio/tasks.md")
    by_id = {row["task_id"]: row for row in tasks}
    phases = []
    for category, config in CATEGORIES.items():
        phase_tasks = []
        for task_id in config["tasks"]:
            task = dict(by_id.get(task_id, {"task_id": task_id, "title": "missing from tasks.md"}))
            task["category"] = category
            task["runtime_completion_claim"] = False
            task["source_candidates"] = candidates(root, config["patterns"])
            task["focused_tests"] = tests(root, config["patterns"])
            task["evidence_status"] = "spec_checked_only" if task.get("spec_checked") else "open_with_adjacent_candidates"
            phase_tasks.append(task)
        phases.append({"category": category, "tasks": phase_tasks})
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "repository": "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
        "source_of_truth": "specs/015-tenant-operating-system-studio/tasks.md",
        "runtime_completion_claim": False,
        "phase_count": len(phases),
        "task_count": sum(len(phase["tasks"]) for phase in phases),
        "phases": phases,
        "safety": {
            "mutates_runtime": False,
            "marks_tasks_complete": False,
            "secrets_included": False,
        },
    }
    destination = args.output or (root / "docs/spec-portfolio/spec015-gap-matrix.generated.json")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(destination), "task_count": output["task_count"], "phase_count": output["phase_count"], "runtime_completion_claim": False}, indent=2))


if __name__ == "__main__":
    main()
