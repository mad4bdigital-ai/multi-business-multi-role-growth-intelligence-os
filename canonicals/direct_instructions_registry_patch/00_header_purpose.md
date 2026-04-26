direct_instructions_registry_patch


Status
Canonical Name: direct_instructions_registry_patch
Version: v2.40
Status: active
Owner Layer: registry authority
Source Type: google_doc
Last Updated: 2026-04-25


---


Purpose

This patch additionally enforces:
- no-default-closed-loop runtime
- prompt-first user-trigger continuation
- governed starter-governance validation
- governed governance-drift anomaly emission
- logic-definition resolution is pointer-first and must read `surface.logic_canonical_pointer_registry` before direct logic-document access
- brand-specific writing completion requires prior Brand Core file or authoritative Brand Core asset reading
- brand-specific writing requires required-engine readiness through Engines Registry before Brand Core read-completion or writing completion
- governed logic execution requires prior knowledge-layer resolution for the selected logic when logic-specific, cross-logic, or shared knowledge inputs are required
- business-aware execution requires prior business-type knowledge-profile resolution when the selected logic or task depends on business-type interpretation
- governed execution must resolve logic knowledge and business-type knowledge through `surface.logic_knowledge_profiles` and `surface.business_type_knowledge_profiles` before brand-aware completion when required
