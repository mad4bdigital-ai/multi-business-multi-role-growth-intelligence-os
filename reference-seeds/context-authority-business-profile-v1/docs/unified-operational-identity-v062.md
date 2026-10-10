# Context Authority / WordPress operational identity acceptance v0.6.2

Core platform supports four host modes without depending on PHP or WordPress. The WordPress Plugin adapter in PR #258 adds a local operational guard that binds Context Authority reads and Content Jobs to Site Profile and stable Brand Profile identity.

A matching receipt for `wordpress_dedicated` must include `tenant_ref`, `brand_ref`, `site_uuid`, `environment`, `deployment_mode`, exact numeric `blog_id`, and `network_id`, in addition to exact source generation, policy revision/digest and artifact provenance. `local` is an accepted *development* environment string but does not grant Staging/Production acceptance; all returned receipts remain review-only.

Host callers cannot treat `assessDeploymentDependencies(...)` or `resolveDeploymentContext(...)` as authorization; caller attestations, detached verification, nonce/replay store and production step-up remain independent gates.

WordPress implementation is a bounded first integration slice, not general operational certification. Legacy Context Sources lacking brand ownership remain quarantined, with no silent migration; Brand Profile rename preserves immutable ownership ID. ContentJob site+brand filtering prevents mixing records in normal repository reads but does not yet prove every alternate execution path is fenced. Standalone PHP/native canaries and real MCP tool invocation are still required.
