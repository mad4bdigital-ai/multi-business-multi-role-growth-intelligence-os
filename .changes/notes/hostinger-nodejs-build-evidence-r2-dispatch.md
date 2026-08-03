# Hostinger Node.js build evidence R2 dispatch

This change adds a fresh, single-use issue-comment bridge for Incident #4953 after the repository operator configured `HOSTINGER_API_TOKEN`.

The bridge validates the authorization comment, trusted main head, target workflow blob, protected Production SHA, and one-time markers before dispatching the unchanged GET-only evidence workflow.

It does not receive the secret value and performs no Hostinger build creation, deployment, restart, provider mutation, SQL, migration Apply, database mutation, protected-ref update, force push, or external send.
