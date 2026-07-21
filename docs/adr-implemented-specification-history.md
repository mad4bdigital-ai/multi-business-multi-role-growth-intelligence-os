# ADR: Placement of Implemented Historical Specifications

## Status
Accepted.

## Context

The repository completion gate treats content under `specs/<feature>/` as an active Spec Kit and requires completion governance such as `completion.json`. Some completed initiatives still have useful architectural and operational history, while their original task plans, checklists, and completion manifests are stale and should not be reactivated on `main`.

The SQL cache resilience work demonstrated this distinction: its implementation and production verification were completed through later merged pull requests, while the original PR #1940 remained a superseded design branch with historical task artifacts.

## Decision

Completed or superseded specifications that are retained only for reference must be curated under:

```text
docs/history/<topic>/
```

They must be clearly marked **Implemented / Historical** and link to current runtime code, tests, migrations, runbooks, and merged delivery evidence.

Do not recreate an active `specs/<feature>/` directory unless the work is intentionally reopening as a governed Spec Kit and will satisfy the current completion gate.

Historical curation must exclude stale task lists, completion manifests, release checklists, and duplicated generated PR documentation unless those artifacts are independently required and accurate.

The original Git branch may remain as archival source evidence when exact files are not content-equivalent to maintained history and the governed branch-cleanup gate therefore blocks deletion.

## Consequences

- `specs/` continues to represent active governed delivery work.
- `docs/history/` contains maintained historical context without implying pending execution.
- Current runbooks and canonical documentation remain operational authority.
- Historical records must not claim current health without fresh runtime readback.
- Branch deletion remains fail-closed when unique historical artifacts are not fully covered.
