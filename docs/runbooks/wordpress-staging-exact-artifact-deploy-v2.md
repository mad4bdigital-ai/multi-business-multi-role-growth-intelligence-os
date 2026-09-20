# WordPress Staging Exact-Artifact Deploy v2

## Purpose

This runbook describes the governed execution plane for deploying an exact reviewed
`mad4bdigital-ai/WordPress` General Distribution candidate to the enrolled Egypt Tour
Gates Staging site.

The surface is Staging-only. It is not Production authority, Breakglass, Raw SQL, File
Manager, or a generic remote shell.

## Runtime contract

The platform route is:

```text
POST /platform/remote-runtime/wordpress/staging/deploy-plugin
```

The execution and producer contracts are:

```text
mad4b.wordpress-staging-plugin-deploy.v2
mad4b.wordpress-deployment-handoff.v2
mad4b.site-control-plane.general-distribution-kit.v1
mad4b.build-provenance.v1
```

Apply remains behind:

```text
REMOTE_RUNTIME_WORDPRESS_STAGING_DEPLOY_ENABLED=true
```

Dry-run is the default and performs no WordPress mutation.

## Caller input boundary

The bounded request may provide only:

```text
expected_head_sha
dry_run
approval_reason
capability_envelope_id
timeout_ms
```

The caller cannot select or supply:

- Hostinger target ID;
- GitHub artifact ID;
- host or WordPress filesystem path;
- SSH authentication mode;
- SSH credentials;
- plugin archive bytes;
- Production target or Production authority.

The exact GitHub artifact is derived from the reviewed WordPress HEAD. The Hostinger
target is resolved server-side from governed target authority.

## Target resolution

The executor requires exactly one active and validated `hosting_account` target with:

```text
plugin_key = remote_ssh_runtime
provider_family = hostinger
environment = staging
origin = https://staging.egypttourgates.com
command allowlist contains wordpress_staging_plugin_deploy
```

Zero matches fail closed.

More than one match fails closed as ambiguous.

The deployment migration intentionally does not create, widen, or repair a target
allowlist. Target authority is governed separately.

## Exact artifact verification

For `expected_head_sha`, the executor reads the successful reviewed
`mad4b-control-plane-package.yml` run from `mad4bdigital-ai/WordPress`.

The expected artifact name is derived server-side:

```text
mad4b-site-control-plane-general-distribution-kit-{expected_head_sha}
```

Before any WordPress write, the executor verifies:

1. successful exact-head package workflow;
2. GitHub Actions outer artifact SHA-256 when GitHub exposes the digest;
3. `install-manifest.json` contract, repository, exact commit and release class;
4. explicit Site Profile tenant-binding requirement;
5. Control Plane archive SHA-256;
6. bundled MCP Adapter 0.6.1 archive SHA-256;
7. bundled adapter digest equals the certified release digest;
8. install order is MCP Adapter before Control Plane;
9. `MAD4B-BUILD-PROVENANCE.json` matches source SHA, build fingerprint,
   package-manifest digest and adapter SHA-256;
10. embedded `staging-deployment-handoff.json` is
    `mad4b.wordpress-deployment-handoff.v2`.

Artifact IDs are evidence returned by GitHub after server-side resolution. They are not
caller authority.

## Live preflight

The executor resolves server-owned SSH credentials and performs a read-only WP-CLI
preflight before the first write.

The live site must prove:

```text
wp_get_environment_type() = staging

home =
https://staging.egypttourgates.com

siteurl =
https://staging.egypttourgates.com

Site Profile configured = true

Site Profile site_uuid =
d745d81f-6fc4-5c6a-99dd-d953c92137bf

Site Profile environment =
staging

Site Profile origin =
https://staging.egypttourgates.com

active MCP Adapter version =
0.6.1
```

Any mismatch blocks before the first write.

## Dry-run sequence

Dry-run verifies:

- exact target resolution;
- exact artifact resolution and artifact/provenance checks;
- server-owned SSH credential resolution;
- live Site Profile/environment/origin preflight.

It returns a sanitized plan and does not upload or replace plugin files.

A dry-run failure must be treated as the authoritative blocker. Do not substitute
filesystem mutation, File Manager, generic plugin update, Raw SQL, Breakglass, or
caller-supplied credentials.

## Apply authorization

Apply requires all dry-run gates plus:

- dedicated runtime feature gate enabled;
- human approval reason;
- exact capability-resolution envelope;
- envelope bound to the same WordPress expected HEAD and deploy capability;
- envelope not previously consumed.

The envelope is referenced before execution and consumed only after successful
same-cycle readback.

## Atomic plugin replacement

The reviewed bundle contains:

```text
1. mcp-adapter-0.6.1.zip
2. mad4b-site-control-plane-<version>.zip
```

The executor:

1. uploads only the verified bundle archives through governed server-owned SSH;
2. re-verifies archive SHA-256 on the remote host;
3. extracts both into staging directories under the WordPress plugin filesystem;
4. verifies plugin versions;
5. requires stage and target paths to be on the same filesystem device;
6. records current activation states and versions;
7. enables WordPress maintenance mode;
8. renames the existing Control Plane and MCP Adapter to unique backup directories;
9. renames the verified bundled MCP Adapter into place first;
10. renames the verified Control Plane into place;
11. activates both;
12. performs exact same-cycle readback.

## Exact same-cycle readback

Success requires all of:

```text
Control Plane version = expected manifest version
MCP Adapter version = 0.6.1
environment = staging
home/site URL = exact ETG Staging origin
Site Profile UUID = exact enrolled UUID
Site Profile environment = staging
Site Profile origin = exact ETG Staging origin

source_commit_sha = expected_head_sha
build_fingerprint = exact artifact build_fingerprint
package_manifest_digest = exact artifact package_manifest_digest
runtime_manifest_match = true
stale = false
provenance_mismatch_count = 0
```

Runtime provenance is read from
`MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status()`.

## Rollback

Any apply or exact readback failure triggers rollback in the same remote execution
cycle.

Rollback restores both previous plugin directories and their previous activation
states, removes staged/uploaded files, disables maintenance mode, and reports
`rollback_result=restored` when restoration completed.

A failed readback is not a successful deployment.

## Security boundaries

The v2 surface does not authorize:

- Production deployment;
- Production authority reuse;
- Breakglass;
- Raw SQL;
- File Manager;
- generic raw-shell API exposure;
- caller-selected target or artifact;
- caller-selected host/path/SSH mode;
- caller-supplied credentials;
- automatic remote-runtime target mutation;
- merge authorization for the WordPress PR.

Responses and evidence are secret-safe and declare `secrets_included=false`.

## ETG PR #11 acceptance sequence

For the current WordPress PR #11 rollout:

1. close exact-head CI on the Growth OS deployment-plane PR;
2. publish/deploy that Growth OS candidate to its governed Staging runtime;
3. discover/read the ETG remote-runtime target;
4. run the WordPress v2 deployment route in dry-run mode for the exact WordPress PR #11 HEAD;
5. if the target command allowlist is the only blocker, govern that target change
   separately and re-run dry-run;
6. obtain explicit apply approval and exact capability envelope;
7. enable the dedicated Staging apply feature gate through normal environment
   configuration governance;
8. execute exact WordPress candidate deployment;
9. verify exact provenance and Site Profile preservation;
10. continue WordPress PR #11 Context Authority / Google Drive live acceptance.

Production remains untouched throughout this Staging acceptance sequence.
