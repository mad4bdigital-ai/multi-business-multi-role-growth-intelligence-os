#!/usr/bin/env python3
"""Governed, manual-only cancellation of provably stale same-repo PR CI runs.

Never acts on pull_request_target, workflow_dispatch, writer, or current-head runs.
"""
import argparse
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

ACTIVE = ("queued", "in_progress", "waiting")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PAGE_LIMIT = 15
CONTRACT = "mad4b.governed-superseded-pr-runs.v1"


def api(method, repo, path, token):
    req = urllib.request.Request(
        "https://api.github.com/repos/" + repo + path,
        headers={"Accept": "application/vnd.github+json",
                 "Authorization": "Bearer " + token,
                 "User-Agent": "MAD4B-Governed-PR-CI",
                 "X-GitHub-Api-Version": "2022-11-28"},
        data=b"" if method == "POST" else None,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        if method == "POST" and exc.code in (409, 422):
            return {"already_finished": True}
        raise


def current_pr(repo, number, expected, token):
    pr = api("GET", repo, "/pulls/" + str(number), token)
    head = pr.get("head") or {}
    if pr.get("state") != "open":
        raise RuntimeError("PR_NOT_OPEN")
    if (head.get("repo") or {}).get("full_name") != repo:
        raise RuntimeError("CROSS_REPOSITORY_PR_UNSUPPORTED")
    if pr.get("base", {}).get("ref") != "main":
        raise RuntimeError("UNEXPECTED_BASE_BRANCH")
    if head.get("sha") != expected:
        raise RuntimeError("PR_HEAD_MOVED")
    return head["ref"]


def is_superseded(run, number, expected_sha, branch):
    return (
        run.get("event") == "pull_request"
        and run.get("status") in ACTIVE
        and run.get("head_branch") == branch
        and run.get("head_sha") != expected_sha
        and number in {
            entry.get("number")
            for entry in (run.get("pull_requests") or [])
            if isinstance(entry, dict)
        }
    )


def list_stale(repo, number, expected_sha, branch, token):
    found = {}
    for state in ACTIVE:
        for page in range(1, PAGE_LIMIT + 1):
            query = urllib.parse.urlencode({
                "branch": branch, "status": state, "per_page": 100, "page": page,
            })
            runs = api("GET", repo, "/actions/runs?" + query, token).get("workflow_runs", [])
            for run in runs:
                if is_superseded(run, number, expected_sha, branch):
                    found[run["id"]] = run
            if len(runs) < 100:
                break
            if page == PAGE_LIMIT:
                raise RuntimeError("INCOMPLETE_RUN_WINDOW")
    return list(found.values())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pr-number", type=int, required=True)
    parser.add_argument("--expected-head-sha", required=True)
    parser.add_argument("--mode", choices=["dry_run", "apply"], default="dry_run")
    parser.add_argument("--confirmation", default="")
    args = parser.parse_args()
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GH_TOKEN", "")
    if (repo != "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"
        or not token or args.pr_number <= 0 or not SHA_RE.fullmatch(args.expected_head_sha)):
        raise SystemExit("INVALID_AUTHORITY_OR_INPUT")
    if args.mode == "apply" and args.confirmation != "CANCEL_SUPERSEDED_PR_CHECKS":
        raise SystemExit("TYPED_CONFIRMATION_REQUIRED")
    branch = current_pr(repo, args.pr_number, args.expected_head_sha, token)
    old = list_stale(repo, args.pr_number, args.expected_head_sha, branch, token)
    print(json.dumps({
        "contract": CONTRACT, "mode": args.mode, "pr": args.pr_number,
        "expected_head_sha": args.expected_head_sha,
        "stale_count": len(old), "run_ids": [x["id"] for x in old],
    }))
    if args.mode != "apply":
        return
    results = {"cancel_requested": 0, "already_finished": 0}
    for run in old:
        # Guard every mutation, not just the start of the batch.
        current_pr(repo, args.pr_number, args.expected_head_sha, token)
        result = api("POST", repo, f"/actions/runs/{run['id']}/cancel", token)
        if result.get("already_finished"):
            results["already_finished"] += 1
        else:
            results["cancel_requested"] += 1
    print(json.dumps(results))


if __name__ == "__main__":
    main()
