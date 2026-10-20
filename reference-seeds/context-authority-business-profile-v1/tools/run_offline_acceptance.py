#!/usr/bin/env python3
"""Offline fail-closed native test orchestrator. No source imports or release grants."""
from __future__ import annotations
import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

SUITES = (
    ("seed_schema", "python", "tools/validate_seed.py"),
    ("seed_adversarial", "python", "tools/test_seed.py"),
    ("content_schema", "python", "tools/validate_content_fabric.py"),
    ("content_adversarial", "python", "tools/test_content_fabric.py"),
    ("media_adversarial", "unittest", "test_audit_source_media.py"),
    ("node_runtime", "node", "runtime/portable-content-runtime.test.mjs"),
    ("node_source_guard", "node", "runtime/context-source-guard.test.mjs"),
    ("node_deployment_modes", "node", "runtime/resolve-deployment-context.test.mjs"),
    ("node_dependency_graph", "node", "runtime/deployment-dependency-evaluator.test.mjs"),
)

def run(root: Path, expected_head: str | None, timeout: int = 60,
        target_host: str = "platform", wordpress_plugin_root: Path | None = None,
        expected_wp_head: str | None = None):
    root = root.resolve()
    if target_host not in ("platform", "wordpress_plugin"):
        raise ValueError("UNSUPPORTED_TARGET_HOST")
    if timeout <= 0 or timeout > 300:
        raise ValueError("INVALID_TIMEOUT")
    suites = []
    git_head = None
    try:
        proc = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10)
        if proc.returncode == 0:
            git_head = proc.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        pass
    pinned = bool(expected_head and git_head and expected_head == git_head)
    # Reject identity drift before launching *any* test or cross-repository hook.
    if not pinned:
        suites = [{"suite": title, "status": "NOT_RUN_HEAD_MISMATCH",
                   "exit_code": None, "duration_ms": 0} for title, _, _ in SUITES]
        if target_host == "wordpress_plugin":
            suites.append({"suite":"wordpress_cross_repo_dependencies",
                           "status":"NOT_RUN_HEAD_MISMATCH",
                           "exit_code":None,"duration_ms":0})
        return {"contract":"mad4b.reference.context-native-acceptance.v1",
                "target_host":target_host,"expected_head":expected_head,
                "observed_head":git_head,"exact_head_match":False,
                "native_static_unit_gate":"BLOCKED",
                "operational_acceptance":False,"publication_authorized":False,
                "production_authorized":False,
                "counts":{"passed":0,"total":len(suites)},"suites":suites}
    for title, kind, name in SUITES:
        file = root / name if kind != "unittest" else root / "tools" / name
        record = {"suite": title, "status": "NOT_RUN", "exit_code": None, "duration_ms": 0}
        if not file.is_file():
            record["status"] = "MISSING_TEST_FILE"
        else:
            command = (
                [sys.executable, str(file)] if kind == "python" else
                [sys.executable, "-m", "unittest", "discover", "-s", str(root / "tools"), "-p", name] if kind == "unittest" else
                [shutil.which("node") or "node", "--test", str(file)]
            )
            started = time.monotonic()
            try:
                p = subprocess.run(command, cwd=root, capture_output=True, timeout=timeout, check=False)
                record.update(status="PASS" if p.returncode == 0 else "FAIL", exit_code=p.returncode)
            except FileNotFoundError:
                record["status"] = "RUNTIME_UNAVAILABLE"
            except subprocess.TimeoutExpired:
                record["status"] = "TIMEOUT"
            record["duration_ms"] = int((time.monotonic() - started) * 1000)
        suites.append(record)
    if target_host == "wordpress_plugin":
        plugin = wordpress_plugin_root.resolve() if wordpress_plugin_root is not None else None
        script = plugin / "tests" / "deployment-mode-dependencies-contract.py" if plugin is not None else None
        check = {"suite":"wordpress_cross_repo_dependencies", "status":"NOT_RUN","exit_code":None,"duration_ms":0}
        if script is None or not script.is_file() or not expected_wp_head:
            check["status"] = "MISSING_PINNED_WORDPRESS_DEPENDENCY"
        else:
            command = [sys.executable, str(script), "--plugin-root", str(plugin),
                       "--core-seed", str(root), "--wp-head", expected_wp_head,
                       "--core-head", str(expected_head or ""), "--run-php"]
            start = time.monotonic()
            try:
                p = subprocess.run(command, cwd=root, capture_output=True, timeout=timeout, check=False)
                check.update(status="PASS" if p.returncode == 0 else "FAIL",exit_code=p.returncode)
            except FileNotFoundError:
                check["status"] = "RUNTIME_UNAVAILABLE"
            except subprocess.TimeoutExpired:
                check["status"] = "TIMEOUT"
            check["duration_ms"]=int((time.monotonic()-start)*1000)
        suites.append(check)
    passed = sum(x["status"] == "PASS" for x in suites)
    return {
        "contract": "mad4b.reference.context-native-acceptance.v1",
        "target_host": target_host,
        "expected_head": expected_head,
        "observed_head": git_head,
        "exact_head_match": pinned,
        "native_static_unit_gate": "PASS" if pinned and passed == len(suites) else "BLOCKED",
        "operational_acceptance": False,
        "publication_authorized": False,
        "production_authorized": False,
        "counts": {"passed": passed, "total": len(suites)},
        "suites": suites,
    }

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--expected-head", required=True)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--target-host", choices=("platform","wordpress_plugin"), default="platform")
    parser.add_argument("--wordpress-plugin-root", type=Path)
    parser.add_argument("--expected-wp-head")
    args=parser.parse_args()
    report=run(args.repo_root, args.expected_head, args.timeout,
               args.target_host, args.wordpress_plugin_root, args.expected_wp_head)
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report["native_static_unit_gate"] == "PASS" else 1)

if __name__=="__main__":
    main()
