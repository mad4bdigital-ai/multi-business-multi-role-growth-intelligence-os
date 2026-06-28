# Spec Kit 005 — Dynamic MCP Schema Surfaces

Status: **Phase 1 implementation complete — merge review in progress; production rollout pending**

This Spec Kit defines the long-term contract between stable Git-controlled OpenAPI transport surfaces, MySQL-primary principal-aware MCP-like tool catalogs, a stateless Activation Edge Gateway, and deterministic generation/deployment evidence.

## Primary outputs

- `spec.md` — normative requirements.
- `research.md` — verified production baseline on 2026-06-25.
- `data-model.md` — current registry mapping and additive changes.
- `plan.md` and `tasks.md` — implementation sequence.
- `acceptance-matrix.md` — executable acceptance criteria.
- `rollout.md` — staged deployment and rollback.
- `contracts/` — canonical surface, MCP facade, and gateway-policy contracts.

The accompanying PR implements deterministic surface generation, the Core/Activation split, the Local Connector canonical, and an inactive stateless Worker package. It does not deploy DNS, bind `activation.mad4b.com`, migrate production rows, change the SQL Tool Bus classification, or replace the current runtime dispatcher.
