# Activation Gateway

Stateless Cloudflare Worker boundary for the fixed Activation transport surfaces.

## Responsibilities

- enforce `activation.mad4b.com` host ownership;
- enforce exact generated path/method/query policy;
- remove cookies and unapproved headers;
- apply request/response size limits and upstream timeouts;
- block redirects;
- validate a deployment attestation signed with Ed25519;
- forward allowed requests to the fixed `https://auth.mad4b.com` origin;
- emit bounded, secret-safe structured logs.

## Non-responsibilities

The Worker does not connect to MySQL, resolve tenant membership, validate business permissions, select providers, resolve credentials, execute tools, or transform Activation business responses. Those responsibilities remain on `auth.mad4b.com`.

## Generated policy

`generated/route-policy.json` is produced by:

```bash
cd http-generic-api
npm run schemas:generate
```

The generated policy is deterministic and contains a SHA-256 content hash. It is not a deployment signature.

## Deployment attestation

Before deployment, sign this canonical JSON payload with an Ed25519 private key held outside the Worker:

```json
{
  "content_hash_sha256": "<generated policy hash>",
  "deployment_id": "<immutable deployment id>",
  "expires_at": "<ISO-8601 timestamp>",
  "source_commit": "<40-or-64-character Git commit SHA>",
  "surface_registry_version": 1
}
```

Configure these encrypted Worker secrets:

- `ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON`: the payload above plus `signature_b64url`;
- `ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK`: the Ed25519 public key JWK.

The Worker fails closed when the signature, content hash, source commit, registry version, or expiry is invalid. Mutations never use a stale policy.

## Rollout

1. Generate schemas and route policy.
2. Run contract and gateway tests.
3. Deploy to the temporary `workers.dev` hostname.
4. Run `/health`, `/ready`, auth pass-through, rejection, and rollback smoke tests.
5. Bind `activation.mad4b.com` only after release readiness succeeds.
