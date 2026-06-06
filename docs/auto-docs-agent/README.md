# Automated Docs Agent Notes

This directory is maintained by the Docs Agent workflow. Each generated note records the documentation impact of a PR or commit so runtime, schema, deployment, and tenant-facing changes do not disappear into chat history or transient CI logs.

Generated notes are reviewable evidence. They do not replace targeted human documentation for high-risk changes, but they make the required docs targets explicit and keep the repository auto-mergeable when a follow-up documentation note is enough.

Rules:

- No secrets or credential values.
- No generated canonical root edits without canonical source edits.
- High-risk notes must name required docs and validation evidence.
- Docs-only agent PRs may be auto-merged only after CI passes.
