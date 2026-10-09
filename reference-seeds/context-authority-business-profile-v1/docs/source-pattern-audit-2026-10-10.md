# Source-pattern audit — 2026-10-10 (no source payloads)

## What was inspected
Owner-provided private Drive folder hierarchy and representative nested materials: bilingual style index and example copy, persona-by-stage targeting matrix, four-axis marketing calendars, evergreen pillar/strategy guidance, channel production guidelines, video sound/visual treatment, sales decks, onboarding and source-variable mappings. **Only abstract structures and limited QA counts are recorded; no Drive IDs, private links, copied proprietary text, credentials or client records.**

## Verified structural observations
1. Bilingual writing-styles index: 51 populated style labels below one header (52 rows total). Semantically overlapping categories require de-duplication rather than assuming 51 independent styles. The current normalized archetype index is a **proposed** 20-family taxonomy, not a certified translation map.
2. Three spreadsheets named as 365-day content plans expose ten numbered days each. The data import must compare declared planning horizon with actual rows, not fabricate days 11–365.
3. Seven six-column CSV calendars contain 120 content rows each, spanning 30 dates with four output formats/day. Both date-first and title-first column order exist and require header-driven mapping. One original startup awareness calendar has 90 generic idea-number placeholder titles; a separate curated version has none in the title field. These are alternative drafts, not 240 distinct approved pieces.
4. A nine-tab conversion workbook mixes a content calendar, product module outline, content pillar matrix, persona list and generation prompts; it is not one normalized data table. Some campaign material repeats themes and day counts.
5. The persona targeting matrix has five audiences across awareness, interest, evaluation, decision. Rich tactic descriptions are concentrated in early-stage rows; other stage-specific content is sparse and must not be silently inferred.
6. Marketing guidance differentiates seven themes of content strategy: education/product, trust/proof, market leadership, business outcomes, operational transformation, communities, and enablement. Separate documents classify inbound/outbound and lifecycle funnel and differentiate organic/paid/social/SEO/email/WhatsApp/PR/UGC/video.
7. A later editorial guide favors plain, evidence-based Arabic; other creative drafts favor hype, aggressive urgency and colloquial styling. Document age or hierarchy alone cannot settle semantic authority; a scoped approved editorial rule and owner evidence must govern each output.
8. Many style examples and sample sales decks contain numerical benefits, superlatives, trial lengths, specific pricing and customer testimonials. They are **unverified example copy** and must be treated as candidate claims, not factual reference seed values.
9. Audio and visual treatments vary by decision-maker type, not merely platform. Production briefs must include voice, pacing, soundtrack licensing, shot type, layout, accessibility and image rights, where relevant.
10. Reusing one idea across a blog, carousel, email and short video requires separate channel outputs with shared source claim identity; it must not imply permission to reuse photos/testimonials or override opt-in requirements.

## Gaps deliberately left OPEN
- Full file-by-file exhaustive audit of every nested Drive file, media binary, and raw PDF was not performed; this sample is broad but not all possible source content.
- No source claims, actual product capabilities, compliance statuses, prices, customer results, campaign targets, or performance benchmark were independently certified.
- No live CMS, analytics or email/WhatsApp send proof, credential access, owner approvals, import-runner execution or SQL migrations were performed.
- All proposed source mappings, normalized styles, funnel rules, and publishing cadences remain illustrative data contracts pending independent owner review.

## Design decisions
- Separate stage vs goal vs content pillar vs tactic vs style vs channel vs format vs persona, and then compose them through field-level Context Authority.
- Do not hardcode persona–channel "best practices" as universal truth. Use reviewed scoped recommendations and experimentation where permitted.
- Validate schedule counts, titles, cross-format duplication, fresh offers, personal data and externally verifiable claims before a row can move beyond draft.
- Keep Brand Voice constraints and editorial bans above campaign prompts and author examples, with block-on-conflict when authority cannot be resolved.
- Make content production a governed DAG: strategy → semantic brief → claims → angle → style → drafts → multimodal assets → QA → approval → independent publication receipt.
