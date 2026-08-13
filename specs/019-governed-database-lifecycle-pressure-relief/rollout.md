# Rollout — Spec 019 Governed Database Lifecycle and Pressure Relief

The rollout is read-only first. PR-B observes and plans without mutation. PR-C proves exact authority and receipt readiness. PR-D runs the response-chunk pilot in non-production with fixed cutoff, bounded batches, receipts, readback, and rollback evidence. PR-E follows only after preservation evidence. JobRunner and autopilot require an observation period and explicit enablement. Engine-run archive/thin and physical reclaim are separate projects.

Production promotion requires staging evidence, canary evidence, migration/readback verification where applicable, security/performance review, rollback verification, and explicit owner approval. No source merge implies migration apply or production dispatch.
