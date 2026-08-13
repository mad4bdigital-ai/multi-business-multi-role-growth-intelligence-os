# Concerns and Trade-offs — Spec 019

The main trade-off is between fast storage relief and preservation safety. A generic age-based delete is simpler but unsafe for audit, session, and execution lineage. Domain adapters increase design work but make the executor reusable without making it dangerous.

Physical reclaim may require engine-specific maintenance windows and can have different operational risk from logical deletion. It must therefore remain a separate recipe and approval path.

The platform currently has multiple lifecycle/reporting surfaces. This Spec Kit intentionally reuses them and avoids introducing a parallel cleanup registry until the existing resource recipe model is proven insufficient.

Incident thresholds and the 45-day audit heuristic are evidence for planning, not defaults. Retention policy must be explicitly approved before automation.
