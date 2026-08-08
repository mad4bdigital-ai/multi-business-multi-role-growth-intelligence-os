# Governed Production Promotion Request

- requested_main_sha: `719c965e955347ab1cc56ad91d96881b4b1af357`
- observed_production_sha: `70dd049a42380116773d45d3283e1ff55e4043a8`
- request_scope: create governed Production synchronization request surface only
- protected_ref_mutation_authorized: `false`
- production_mutation_authorized: `false`
- force_push_authorized: `false`

This request surface supersedes the stale `a06e8e087609508e3a1944ddaab8cf0156484529` request lineage after `main` advanced through repository contract auto-sync #6682. It does not authorize merging, deployment, protected-ref mutation, Production mutation, SQL, migration apply, provider/Hostinger mutation, credential access, or force push. The governed launcher requires a separate typed confirmation `AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST` before candidate convergence may run.