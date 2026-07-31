# Requirements Checklist

- [x] T500 isolated ephemeral checkout is implemented, merged, and covered by focused regressions.
- [x] T501 short-lived repository credential binding is implemented, merged, and covered by containment regressions.
- [x] T502 governed remote fetch, checkout, commit, fast-forward push, and same-cycle readback are implemented and merged.
- [x] Workspace paths are excluded from SQL, JSON, logs, public responses, and evidence.
- [x] Credential values and derived secret identifiers are excluded from persistence and serialization.
- [x] Credential TTL and repository/worker scope are bounded and revalidated.
- [x] Credential release precedes workspace cleanup on success and failure paths.
- [x] Platform credential fallback is not widened by orchestrator integration.
- [x] The additive enum migration preserves `virtual_git_tree` and adds `ephemeral_checkout`.
- [x] The migration passed the exact checksum-bound preflight contract with zero risks and one statement.
- [x] The migration was applied through governed Production authority and recorded in the migration ledger.
- [x] Read-only Production schema verification confirmed `enum('virtual_git_tree','ephemeral_checkout') NOT NULL`.
- [x] Existing operation security, capability, ownership, artifact, and lifecycle contracts remain preserved.
- [x] Focused tests are registered in the canonical manifest and required CI gates passed.
- [x] Rollback remains separately governed and requires draining active workers plus proving no rows use `ephemeral_checkout` before enum narrowing.
- [x] Spec 011 completion evidence is closed without merging temporary operational workflows.
