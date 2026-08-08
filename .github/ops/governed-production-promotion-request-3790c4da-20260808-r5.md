# Governed Production Promotion Request

- requested_main_sha: `3790c4da3f7fa0fb49d1af6d848b0f4a7d11be98`
- observed_production_sha: `70dd049a42380116773d45d3283e1ff55e4043a8`
- request_scope: create governed Production synchronization request surface only
- protected_ref_mutation_authorized: `false`
- production_mutation_authorized: `false`
- force_push_authorized: `false`

This request surface replaces the stale `894f112c452887e9c8f3f58fe55af598cb04af31` candidate lineage after `main` advanced. It does not authorize candidate dispatch, merging, deployment, protected-ref mutation, Production mutation, SQL, migration apply, provider/Hostinger mutation, credential access, or force push. The governed launcher requires a separate typed confirmation `AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST` before candidate convergence may run.
