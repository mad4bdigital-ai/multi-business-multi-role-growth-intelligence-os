from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATION = "20260730_hostinger_production_resync_policy.sql"
MARKER = f"<!-- SURFACE_CONTRACT: {MIGRATION} -->"
TARGETS = [
    REPO_ROOT / "Updating Registry Patch Index.md",
    REPO_ROOT / "docs" / "ai-docs-agent-governance.md",
    REPO_ROOT / "docs" / "auto-docs-agent" / "README.md",
    REPO_ROOT / "docs" / "change-documentation-governance.md",
]
BLOCK = f'''\n\n{MARKER}\n## Hostinger production resynchronization policy contract\n\n- Migration: `{MIGRATION}`.\n- Policy authority: `repository_main_moved_trigger_policy_v1`.\n- Readiness evidence: the migration inserts or updates an active, blocking policy with a valid JSON policy payload and a same-cycle SQL readback for `active` and `blocking`.\n- Execution boundary: the migration is additive and idempotent; it does not deploy, restart, enqueue execution, call a provider, read credential payloads, send externally, or perform an external write.\n- Release requirement: a main-branch movement requires a governed synchronization plan, a fresh Hostinger build, exact Production merge-SHA readback, and healthy same-cycle runtime evidence before readiness.\n- Secrets: `secrets_included=false`.\n'''

for target in TARGETS:
    if not target.exists():
        raise SystemExit(f"hostinger_policy_doc_target_missing:{target.relative_to(REPO_ROOT)}")
    source = target.read_text(encoding="utf-8")
    if MARKER not in source:
        target.write_text(source.rstrip() + BLOCK, encoding="utf-8")

print("Hostinger policy documentation contract materialized")
