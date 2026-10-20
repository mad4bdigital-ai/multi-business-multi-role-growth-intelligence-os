# Deployment-mode composition — Common Core + WordPress Dedicated Adapter

All of the following modes are built-in, first-class portable contract variants: `shared_multi_tenant`, `dedicated_isolated`, `dedicated_autonomous`, `wordpress_dedicated`. They are NOT mutually exclusive project directions, and the WordPress adapter does not replace shared/platform support.

## Defaults and host ownership

- Generic platform default: `shared_multi_tenant`.
- Installed MAD4B WordPress plugin default: `wordpress_dedicated` **after trusted Site Profile enrollment**.
- The other dedicated platform modes are explicit host-selected variants with their own trust services.
- The mode is established by the hosting runtime, never by prompt, client-controlled form values, URL parameters or guessed hostnames.
- A verified `site_uuid`, per-site Brand Context `brand_id`, and WordPress blog/network IDs are the local WP scope. Missing site or brand registration blocks context resolution; it must not silently invent tenant or brand identities.

## WordPress implementation

The specific read-only reference implementation resides in the WordPress plugin repository, on the feature branch of PR #258: `includes/class-mad4b-scp-deployment-mode-resolver.php`. It reuses Site Profile and Context Authority, registering `mad4b/deployment-mode-status` under the existing read permission. The global reference Seed does NOT directly require WordPress classes. It can be used by SaaS, isolated infrastructure, or local autonomous hosts.

WordPress Multisite: always bind blog and network to a site-specific enrollment. A single WordPress blog currently exposes one existing Brand Context Profile. A future multi-brand registry may extend that mapping; the existence of the four deployment modes is not proof that one WordPress blog can select multiple brands today.

## Trust and rights

The JavaScript reference resolver `runtime/resolve-deployment-context.mjs` returns **BOUND_FOR_REVIEW_ONLY** after its injected host-binding callback succeeds. That callback alone is not an independently signed verification service and can be spoofed by an untrusted caller; therefore the returned object is never an execution/publishing grant.

Real WordPress writes still require WordPress Capabilities and existing MAD4B Site Profile write readiness, operation-specific approvals, audit, postcondition readback, and Production separation. Local autonomous mode retains local trust separation; a dedicated installation must not sign its own proof and treat that signature as independent external acceptance.

## Acceptance scenarios

- Shared mode still resolves from a platform-owned tenant registry.
- Isolated and autonomous modes continue to require their own deployment identities.
- WordPress Dedicated resolves automatically only with trusted Site Profile + valid brand profile.
- Client-supplied tenant, brand, deployment mode, site UUID, blog ID, or network ID cannot override a verified binding.
- Site clone, origin mismatch, environment drift, no brand profile, revoked identity and no host verifier all fail closed.
- Changing deployment mode is a governed rebind/re-certification process, never a silent fallback.
