#!/usr/bin/env python3
"""Host hygiene inventory: REPORT ONLY. Never deletes files or manages services.

Candidate means "requires human classification", NOT safe to delete.
The sole optional write is an atomic JSON report to the requested output path.
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

SAFE_FIELDS = ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree")


def memory_info(path="/proc/meminfo"):
    result = {}
    try:
        for line in Path(path).read_text().splitlines():
            key, _, value = line.partition(":")
            if key in SAFE_FIELDS:
                result[key] = int(value.strip().split()[0]) * 1024
    except (OSError, ValueError, IndexError):
        return {}
    return result


def memory_pressure(path="/proc/pressure/memory"):
    try:
        lines = Path(path).read_text().splitlines()
        return {l.split()[0]: dict(x.split("=", 1) for x in l.split()[1:])
                for l in lines if l and l.split()[0] in ("some", "full")}
    except (OSError, ValueError):
        return {}


def disk_info(path="/"):
    d = shutil.disk_usage(path)
    return {"total_bytes": d.total, "used_bytes": d.used,
            "free_bytes": d.free,
            "used_percent": round(d.used * 100 / max(d.total, 1), 1)}


def probe_kib(path: Path, timeout: int):
    try:
        p = subprocess.run(["du", "-skx", "--", str(path)], capture_output=True,
                           text=True, timeout=timeout, check=True)
        return int(p.stdout.split()[0])
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def candidate_class(path: Path, policy: dict):
    if path.name in set(policy.get("protected_names", [])):
        return "protected_system_path"
    if any(path.name.startswith(p) for p in policy.get("prohibited_prefixes", [])):
        return "protected_system_path"
    if (path / ".git").exists() or (path / ".git").is_symlink():
        return "git_checkout_preserve_for_review"
    return "temporary_path_manual_review"


def inspect_root(path: Path, policy: dict, now: float):
    counts = {"visited": 0, "old": 0, "skipped": 0, "limited": False}
    found = []
    try:
        root_stat = path.lstat()
        if not path.is_dir() or path.is_symlink():
            return found, {"error": "root missing, symlinked, or not a directory"}
        children = sorted(path.iterdir(), key=lambda p: p.name)
    except OSError as exc:
        return found, {"error": type(exc).__name__}
    maximum = int(policy["max_entries_per_root"])
    min_age = float(policy["minimum_age_days"]) * 86400
    for child in children[:maximum]:
        counts["visited"] += 1
        try:
            st = child.lstat()
            if child.is_symlink() or st.st_dev != root_stat.st_dev:
                counts["skipped"] += 1
                continue
            if not child.is_dir() or now - st.st_mtime < min_age:
                continue
            counts["old"] += 1
            classification = candidate_class(child, policy)
            if classification == "protected_system_path":
                counts["skipped"] += 1
                continue
            size_kib = probe_kib(child, int(policy["size_probe_timeout_seconds"]))
            found.append({"path": str(child), "age_days": int((now - st.st_mtime) / 86400),
                          "size_kib": size_kib, "classification": classification,
                          "eligible_for_automatic_deletion": False})
        except (OSError, PermissionError):
            counts["skipped"] += 1
    counts["limited"] = len(children) > maximum
    return found, counts


def existing_prune_risks():
    """Read existing schedules; never alter them."""
    risks = []
    cron = Path("/etc/cron.d/docker-image-prune")
    try:
        raw = cron.read_text()
        if re.search(r"docker\s+image\s+prune\s+-af", raw):
            risks.append("existing_cron_forces_unused_image_deletion; review rollback retention")
    except OSError:
        pass
    return risks


def generate(policy: dict, now: float | None = None):
    if policy.get("mode") != "report_only" or policy.get("schema_version") != 1:
        raise ValueError("only schema_version=1, mode=report_only supported")
    now = now if now is not None else time.time()
    all_candidates, roots = [], {}
    for value in policy.get("temporary_roots", []):
        path = Path(value)
        if not path.is_absolute() or str(path) in ("/", "/var", "/home", "/root", "/opt", "/srv"):
            raise ValueError(f"unsafe scan root: {path}")
        candidates, summary = inspect_root(path, policy, now)
        roots[str(path)] = summary
        all_candidates.extend(candidates)
    all_candidates.sort(key=lambda c: (c["size_kib"] or 0), reverse=True)
    report = {
        "schema_version": 1, "mode": "report_only",
        "time_utc": dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(),
        "disk": disk_info(), "memory": memory_info(),
        "memory_pressure": memory_pressure(), "roots": roots,
        "candidate_count": len(all_candidates),
        "largest_candidates": all_candidates[:int(policy["max_reported_candidates"])],
        "warnings": existing_prune_risks(),
        "destructive_actions_executed": 0,
    }
    if report["disk"]["used_percent"] >= float(policy["disk_warning_percent"]):
        report["warnings"].append("root_filesystem_near_capacity")
    mem = report["memory"]
    if mem.get("SwapTotal", 0) and (mem["SwapTotal"] - mem.get("SwapFree", 0)) * 100 / mem["SwapTotal"] >= float(policy["swap_warning_percent"]):
        report["warnings"].append("swap_high_usage_check_pressure_and_io_before_action")
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", required=True)
    parser.add_argument("--output", help="atomically write a local 0600 JSON report")
    args = parser.parse_args()
    policy = json.loads(Path(args.policy).read_text())
    result = generate(policy)
    payload = json.dumps(result, ensure_ascii=True, indent=2) + "\n"
    if args.output:
        target = Path(args.output)
        if not target.parent.is_dir() or target.parent.is_symlink():
            raise ValueError("output directory must already exist and not be a symlink")
        fd, staging = tempfile.mkstemp(prefix=".hygiene-", dir=str(target.parent))
        try:
            with os.fdopen(fd, "w") as out:
                os.fchmod(out.fileno(), 0o600)
                out.write(payload)
            os.replace(staging, target)
        finally:
            if os.path.exists(staging):
                os.unlink(staging)
        print(f"Report saved: {target}; candidates: {result['candidate_count']}; no deletion")
    else:
        sys.stdout.write(payload)


if __name__ == "__main__":
    main()
