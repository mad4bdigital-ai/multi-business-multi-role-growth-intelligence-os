#!/usr/bin/env python3
"""Read-only Docker QA inventory. Does not stop, delete, or inspect env/secrets."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

REQUIRED = ("ops.lifecycle", "ops.environment", "ops.expires_at", "ops.owner")
CRITICAL = re.compile(r"(?:^|[-_])(database|db|postgres|mariadb|mysql|redis|storage|proxy|gateway|authority|registry|oauth)(?:$|[-_])", re.I)
SUGGEST = re.compile(r"(?:^|[-_])(qa[0-9]*|test|sandbox|ops|browser|probe)(?:$|[-_])", re.I)


def parse_utc(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value):
        return None
    try:
        return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def describe(obj, now):
    cfg = obj.get("Config") or {}
    labels = cfg.get("Labels") or {}
    host = obj.get("HostConfig") or {}
    name = str(obj.get("Name") or "").lstrip("/")
    mounts = obj.get("Mounts") or []
    persistent = any(x.get("Type") in ("volume", "bind") for x in mounts)
    managed = str(labels.get("coolify.managed", "")).lower() == "true"
    project = labels.get("com.docker.compose.project") or ""
    restart = ((host.get("RestartPolicy") or {}).get("Name") or "no")
    explicit = labels.get("ops.lifecycle") == "ephemeral" and labels.get("ops.environment") == "qa"
    expiry = parse_utc(labels.get("ops.expires_at"))
    owner = labels.get("ops.owner")
    owner_ok = isinstance(owner, str) and bool(re.fullmatch(r"[A-Za-z0-9._-]{2,80}", owner))
    configured = any(k in labels for k in REQUIRED)
    qa_hint = bool(SUGGEST.search(name) or SUGGEST.search(project)
                   or name.endswith("-restore-cert") or name.endswith("-local-open-model"))
    review_blockers = []
    if managed:
        review_blockers.append("managed_by_orchestrator")
    if persistent:
        review_blockers.append("persistent_mounts")
    if CRITICAL.search(name):
        review_blockers.append("critical_service")
    if restart in ("always", "unless-stopped", "on-failure"):
        review_blockers.append("restart_enabled")
    if bool(host.get("PortBindings")):
        review_blockers.append("published_port")

    if managed or name in ("coolify", "coolify-db", "coolify-redis", "coolify-proxy", "coolify-sentinel"):
        decision = "protected_managed"
    elif CRITICAL.search(name) or persistent:
        decision = "protected_data_or_critical"
    elif configured and (not explicit or expiry is None or not owner_ok):
        decision = "incomplete_or_invalid_qa_labels"
    elif explicit and owner_ok and expiry is not None:
        decision = "expired_qa_manual_review" if expiry <= now else "labelled_qa_not_expired"
    elif SUGGEST.search(name):
        decision = "possible_qa_manual_review"
    else:
        decision = "unclassified_preserve"
    return {
        "id": str(obj.get("Id") or "")[:12], "name": name,
        "state": str((obj.get("State") or {}).get("Status") or "unknown"),
        "project": project, "restart_policy": restart,
        "has_persistent_mounts": persistent,
        "has_host_port_bindings": bool(host.get("PortBindings")),
        "coolify_managed": managed, "lifecycle": decision,
        "qa_review_hint": qa_hint, "review_blockers": review_blockers,
        "expiry_utc": labels.get("ops.expires_at") if explicit else None,
        "cleanup_authorized": False
    }


def inventory(containers, now):
    records = [describe(x, now) for x in containers]
    counts = {}
    for item in records:
        counts[item["lifecycle"]] = counts.get(item["lifecycle"], 0) + 1
    return {"schema_version": 1, "mode": "report_only",
            "timestamp_utc": now.isoformat(), "total": len(records),
            "running": sum(x["state"] == "running" for x in records),
            "classification": counts,
        "qa_review_hint_count": sum(x["qa_review_hint"] for x in records),
        "qa_review_queue": sorted([x["name"] for x in records if x["qa_review_hint"]]),
        "containers": sorted(records, key=lambda x: x["name"]),
            "operations_performed": [], "automatic_stop": False, "automatic_removal": False}


def docker_snapshot(timeout=25):
    p = subprocess.run(["docker", "ps", "-aq", "--no-trunc"], capture_output=True, text=True, timeout=timeout, check=True)
    ids = p.stdout.splitlines()
    if len(ids) > 250 or any(not re.fullmatch(r"[0-9a-f]{64}", x) for x in ids):
        raise ValueError("unexpected number or type of Docker container IDs")
    if not ids:
        return []
    p = subprocess.run(["docker", "inspect", "--type=container", *ids],
                       capture_output=True, text=True, timeout=timeout, check=True)
    return json.loads(p.stdout)


def write_report(path, report):
    if not path.is_absolute() or '..' in path.parts or path.is_symlink():
        raise ValueError("unsafe report path")
    parent = path.parent
    if not parent.is_dir() or parent.is_symlink() or parent.stat().st_mode & 0o077:
        raise ValueError("report directory must be private")
    fd, staging = tempfile.mkstemp(prefix=".qa-inventory-", dir=str(parent))
    try:
        with os.fdopen(fd, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(report, stream, indent=2, sort_keys=True)
            stream.write("\n")
        os.replace(staging, path)
    finally:
        if os.path.exists(staging):
            os.unlink(staging)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = inventory(docker_snapshot(), dt.datetime.now(dt.timezone.utc))
    if args.output:
        write_report(args.output, report)
        print(json.dumps({"total": report["total"], "running": report["running"],
                          "classification": report["classification"],
                          "report_path": str(args.output), "automatic_removal": False}))
    else:
        print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
