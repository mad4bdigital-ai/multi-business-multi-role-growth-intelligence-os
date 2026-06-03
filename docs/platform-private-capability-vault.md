# Platform Private Capability Vault

## Purpose

The Platform Private Capability Vault is the governed intake, packaging, install,
variant, and runtime-resolution layer for private platform capabilities. It is
broader than a Google file reader: Google Drive, GitHub forks, imported skill
packs, knowledge packs, and future private runtime candidates are source adapters
that feed the same vault contract.

## Lifecycle

```text
External Source / Fork / Google Workspace File
  -> Raw Immutable Mirror
  -> Sanitized Platform Package
  -> Certified Package Version
  -> Tenant / Brand / User Variant
  -> Runtime Resolver
  -> Agent Skill Grant / Engine Dispatch
```

## Copies

`Raw Mirror` stores immutable evidence. It can include every source asset,
including scripts, hooks, workflows, Docker files, and MCP descriptors, but it is
read-only and never executed.

`Sanitized Package` is the runtime/product package. It imports only safe,
declarative assets such as `SKILL.md`, `references/*.md`, `evals/*.md`,
README/LICENSE/SECURITY, and normalized manifests. Blocked assets are retained as
evidence in blocked manifests rather than silently ignored.

`Tenant Install Overlay` stores tenant, brand, user, grant, status, policy, and
override decisions. It is a DB overlay, not a repo clone.

## Import Policy

Allowed by default:

- `*/SKILL.md`
- `references/*.md`
- `evals/*.md`
- `README.md`, `LICENSE`, `SECURITY.md`
- Declarative JSON manifests that do not contain install or execution hooks

Blocked by default:

- hooks and shell scripts
- `.github/workflows/*`
- `.mcp.json`
- Docker files and compose files
- executable binaries
- package install/postinstall scripts
- runtime harnesses that require code execution

## Reinstall Contract

Reinstall is an idempotent diff-aware upgrade plan. It must not duplicate
installs or reset tenant overrides, brand bindings, agent grants, disabled
skills, thresholds, approval state, or policy overlays.

Install requests produce one of these decisions:

- `no_op`
- `metadata_refresh_only`
- `new_assets_available`
- `safe_patch_available`
- `breaking_upgrade_available`
- `duplicate_detected`
- `conflict_detected`
- `blocked_by_policy`
- `requires_recognition_review`
- `requires_certification`

## Variant Contract

Private customization is versioned, scoped, diffable, reversible, certifiable,
audited, and mergeable. Precedence is:

```text
Platform hard policy
  -> package base manifest
  -> tenant variant
  -> business type defaults
  -> brand variant
  -> user variant
  -> task context overlay
  -> runtime resolver
```

Lower layers can specialize or narrow behavior, but cannot open permissions or
source types that an upper layer prohibits.

## Google Workspace Adapter

Google file reading is one adapter under this vault. It must not fetch a
browser URL directly. It resolves a file ID, probes Drive metadata with
`supportsAllDrives=true`, then selects a bounded read strategy by product and
MIME type. Session Transcript Docs should prefer a linked Drive JSONL artifact
when available, then fall back to the Doc.

The resolver returns decisions only. Chunk reads and live provider calls are
separate governed operations that require runtime credentials and live testing.


## Repo Ingestion Contract

Repository intake is snapshot-first and diff-aware. A tenant or user never installs
from a mutable branch. The platform pins `source_repo_full_name`, `commit_sha`,
`tree_sha`, file paths, and blob hashes, then classifies assets before any
package or install overlay is created.

The ingestion lanes are:

- `index_only` for catalogs and directories
- `knowledge_asset_import` for guides and documentation
- `private_skill_import` for declarative skill packs
- `tool_candidate_private` for small adapters or tools that need wrapping
- `runtime_candidate_sandbox` for agent runtimes and harnesses
- `restricted_quarantine` for cyber, reverse-engineering, voice cloning, or
  autonomous finance/trading surfaces

The platform stores repo inventory, snapshots, file inventory, candidate assets,
skill candidates, capability candidates, install requests, and certification
runs separately so that discovery, package import, tenant install, certification,
and runtime dispatch remain independent gates.

## Install Request and Variant Merge Contract

Install request planning is read-only until an explicit apply path exists. It
checks package certification, risk class, tenant policy, auto-install eligibility,
and approval requirements without creating installs or grants.

When a base package is updated, scoped variants are rebased by a three-way merge:

```text
old base + scoped variant patches + new base -> merge plan
```

Append/narrowing patches can auto-merge. Overrides against changed base assets
become conflicts. Tool, permission, or runtime-surface expansion is blocked until
approval and certification.