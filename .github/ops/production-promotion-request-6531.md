# Governed Production synchronization request

Control issue: #6531

Purpose: trigger the repository-canonical exact-main-tree Production candidate builder before Migration 1048 readiness/apply.

Pinned at request creation:
- main: 39e65fcdba88836d9348d41cb2d2ae5adc04d20a
- Production: e083291cb73b57932e25367ce0228f1c5802c68f

This request surface is temporary and must not be merged. It authorizes no SQL, migration Apply, deployment, provider call, credential read, secret access, protected-ref bypass, or force push.
