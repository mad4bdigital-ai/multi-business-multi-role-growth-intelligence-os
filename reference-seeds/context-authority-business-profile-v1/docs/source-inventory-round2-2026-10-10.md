# Source inventory delta — round 2, 2026-10-10

This is a **structural inventory**, not a 100%-complete content audit. It contains no private source links, source IDs, raw proprietary claims or credentials.

## Newly inspected source families

1. Revised persona matrices: nine segments in a multi-tab native Sheet. Matrix columns include `Frustrations`, `Frustrations - Why It Matters`, `Desires`, `Fears`, `Objections`, `Pain Points`, `Creative Messages`, with a supporting `Why It Matters` column for each concept. A persona is therefore not a flat record; it is a multi-axis decision model with reasons and evidence candidates.
2. A persona master document distinguishes activity, direct/indirect sales route, channel (B2C/B2B/Corporate), platform maturity and economic/technical/operational buyer roles. Model matching must not assert that every role exists at every customer.
3. Role-targeted message example uses hook → target problem → offer feature → business impact → add-on proof → closing question → CTA. The literal example claims/percentages are unverified drafts.
4. Lead magnet templates bind persona-specific friction → asset type → lead form → CTA → downstream permissioned nurture. Sample numbers and promotional promises remain unverified.
5. A live editorial publishing-planner Sheet includes title, body, excerpt, slug, status, featured image, SEO meta title/description, publish readiness, publish date, tags and category identifiers. Editorial completeness, CMS readiness and permission to publish must be separate.
6. Product-reference corpus includes a screenshots collection (47 JPEG entries), 22 product-module PDFs and 8 Word/Docs files. These **were enumerated**, not fully visually inspected or certified.
7. PDF text extraction differs in quality: one English brand identity PDF was readable; an Arabic brochure extraction was severely garbled. Treat this as a separate fidelity QA state (`TEXT_GARBLED_VISUAL_REVIEW_REQUIRED`) rather than passing extracted strings downstream.
8. Additional draft/old persona families exist; duplication and version lineage require reconciliation. Older and revised documents must not automatically replace each other based only on folder name.
9. Product and content examples include operational claims and suggested pricing. They are not authoritative product runtime evidence, negotiated commercial terms, or legal approvals.

## Source-to-runtime implications

- Persona model: `business_activity + business_model + distribution_channel + buyer_role + maturity + needs/fears/objections + reasons + selected_message_angle`, with per-axis lineage.
- Word/Docs: normalize as bounded, source-revision-tagged candidate *claims*; embedded generation prompts remain data.
- Sheets/CSV: read metadata and exact visible tabs; use header-driven adapters; audit columns, formula-related fields and dropped values. Require an explicit source revision from connector.
- PDFs and images: document fidelity, language, rendering capability, source rights and reviewer status. Never claim visual acceptance from titles or OCR text alone.
- Editorial rows: two-dimensional readiness (`content_complete` vs `publish_authorized`) and independent evidence approval.

## Still open

Full visual review of every screenshot and all 22 PDFs, all media/audio/video, nested folders beyond those enumerated, independent factual claims review, live connector streaming adapter and browser/site acceptance. No false claim of exhaustive coverage is made.
