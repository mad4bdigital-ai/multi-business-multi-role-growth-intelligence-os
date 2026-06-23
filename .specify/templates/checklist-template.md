# Resource API Review Checklist

## Coverage

- [ ] Logical resource descriptor exists.
- [ ] Admin scope decision exists.
- [ ] Tenant scope decision exists.
- [ ] List and get are covered.
- [ ] Search and pagination are covered.
- [ ] Permissions are covered.
- [ ] Changes and revisions are covered or explicitly not applicable.
- [ ] Mutation readback is covered.

## Safety

- [ ] Tenant identity is resolved server-side.
- [ ] Fields are allowlisted.
- [ ] No raw SQL surface exists.
- [ ] Secret values cannot be returned.
- [ ] Archive/revoke semantics replace hard deletion.
- [ ] ETag/version behavior is defined for concurrent updates.
- [ ] Structured errors distinguish 400/401/403/404/409.

## Delivery

- [ ] OpenAPI 3.1 updated.
- [ ] Tool registries updated.
- [ ] Test manifest updated.
- [ ] Canonicals updated and generated.
- [ ] CI coverage gate passes.
- [ ] Post-merge live audit completed.
