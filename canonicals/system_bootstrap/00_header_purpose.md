system_bootstrap


Status
Canonical Name: system_bootstrap
Version: v5.63
Status: active
Owner Layer: orchestration
Source Type: repository_canonical
Last Updated: 2026-04-25


---


Purpose

- logic-definition resolution is pointer-first and must read `surface.logic_canonical_pointer_registry` before direct logic-document access
- canonical file authority must resolve from repository-backed canonicals through `github_api_mcp` when repository authority is selected
- activation transport must default to `http_generic_api` as the governed execution transport
- provider-specific endpoints such as Google Drive, Google Sheets, or Google Docs may be used only when selected by registry governance for mutable live-surface validation
- the operator may prompt through an AI agent UI, but the UI is not an authority surface
- brand-specific writing completion requires prior Brand Core file or authoritative Brand Core asset reading
- brand-specific writing requires required-engine readiness through Engines Registry before Brand Core read-completion or writing completion
- governed logic execution requires prior knowledge-layer resolution for the selected logic when logic-specific, cross-logic, or shared knowledge inputs are required
- business-aware execution requires prior business-type knowledge-profile resolution when the selected logic or task depends on business-type interpretation
- governed execution must orchestrate logic knowledge and business-type knowledge reads through `surface.logic_knowledge_profiles` and `surface.business_type_knowledge_profiles` before brand-aware completion when required


Canonical Governed Logic Presentation Orchestration Rule
