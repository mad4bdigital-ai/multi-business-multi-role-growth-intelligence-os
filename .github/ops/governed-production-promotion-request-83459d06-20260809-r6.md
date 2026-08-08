# Governed Production Promotion Request

- requested_main_sha: `83459d067782b9a7034bfe3fbcb2cee11010966b`
- observed_production_sha: `70dd049a42380116773d45d3283e1ff55e4043a8`
- request_scope: create governed Production synchronization request surface only
- protected_ref_mutation_authorized: `false`
- production_mutation_authorized: `false`
- migration_apply_authorized: `false`
- provider_mutation_authorized: `false`
- credential_access_authorized: `false`
- force_push_authorized: `false`

This request surface supersedes stale Production promotion request lineages that were pinned before `main@83459d067782b9a7034bfe3fbcb2cee11010966b`. It does not authorize candidate dispatch, merging, deployment, protected-ref mutation, Production mutation, SQL, migration apply, provider/Hostinger mutation, credential access, or force push. The governed launcher requires a separate typed confirmation `AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST` before candidate convergence may run.
