# Cross-repository dependency closure — Context Authority and WordPress Dedicated

Status: implementation-level reference and native-test prerequisites, NOT operational or publishing acceptance.

## Four first-class modes, no forced replacement

The common mode contract retains `shared_multi_tenant` as the default for the platform, and both `dedicated_isolated` and `dedicated_autonomous` as first-class host-selected modes. `wordpress_dedicated` is the default for an explicitly enrolled MAD4B WordPress installation. None of these is inferred from a client request, domain name or marketing configuration.

## Hard dependency boundaries

| Layer | Hard requirements | Soft requirements / effect |
| --- | --- | --- |
| Common core | Trusted host identity, per-mode tenant/brand and separation, external trust callback | No dependency on PHP or WordPress |
| Isolated dedicated | Immutable deployment identity, tenant/brand registry and isolated verifier | Loss of centralized control plane does not silently change mode |
| Autonomous dedicated | Local identity, independently controlled verifier and durable replay protection | Central control plane not required for the identity contract |
| WordPress Dedicated | Registered Site Profile v2 and **bound** deployment identity, site UUID and revision, Context Authority Brand Profile v1 and revision, active blog and network | WordPress Abilities API, read policy and MCP Adapter required for MCP discovery; not for local identity computation |
| Optional integrations | N/A | Google Drive, WooCommerce, Elementor, JetEngine, WPML and Rank Math degrade only their own capabilities |

The WordPress adapter in **WordPress PR #258** returns `mad4b.deployment-mode-resolution.v1` and projects into `mad4b.context-deployment-mode.v1`. It is currently a read-only bridge with a separate, independently verified host acceptance requirement. Do not replace `tenant_ref` or `brand_ref` with arbitrary request values even for a single WordPress installation.

### Dependency state model

Use `VERIFIED` only for host-confirmed inputs; `NOT_DETECTED`, `UNKNOWN`, `STALE` and `UNAVAILABLE` never count as verified. The offline evaluator reports one of `BLOCKED`, `DISCOVERY_BLOCKED_ONLY` or `READY_FOR_REVIEW_ONLY`; all leave `execution_authorized=false`.

The optional provider status `OBSERVED_VERIFIED_BY_HOST` means the host supplied an asserted result to the pure evaluator, not that an external signer, source rights or live integration was independently proven.

## Migrations, drift and failure modes

- Existing legacy WordPress enrollment with `deployment_binding_match=true` but no saved bound identity must not be promoted. Re-enroll through the existing governed Site Profile path.
- A copied WP database/domain or changed environment must revalidate exact site/deployment binding and brand lineage; do not auto-generate new tenant IDs and silently continue.
- WP Multisite blog/network values are part of every read-only scope; no cross-blog fallback.
- A site with no Business Profile remains unresolved; separate governed multi-brand selection is future work, not implied by the deployment modes.
- A changed source or brand revision invalidates derived contexts; no old approval ticket is implicitly reusable.
- Missing Google Drive or SEO provider does not block the local WordPress identity, and does not authorize switching to another source.
- Missing WordPress Ability/MCP transport prevents conversation discovery, **not** core PHP Site Profile evaluation.

## Exact-head no-CI acceptance

The core offline runner supports `--target-host wordpress_plugin` with `--wordpress-plugin-root` and `--expected-wp-head` to invoke the separate plugin dependency checker. Both repos must be checked out at the specified commits and the PHP fixture and Node/Python suites must execute successfully to mark **static native acceptance**.

Passing these tests is **not** operational WordPress acceptance: it does not replace a signed Site Profile readback, capability-specific governed grants, provider contract verification, browser acceptance or a real staging deployment. All modes and manifests remain non-authorizing.
