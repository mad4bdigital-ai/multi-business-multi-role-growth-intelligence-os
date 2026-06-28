# Security Checklist

- [ ] Unknown tool/surface/policy fails closed.
- [ ] Tenant scope comes from signed principal.
- [ ] No client-provided raw upstream URL.
- [ ] No secrets in list responses, manifests, logs, or errors.
- [ ] Cookies and hop-by-hop headers are stripped.
- [ ] Authorization header multiplicity is rejected.
- [ ] Encoded slash/backslash/dot-segment attacks are rejected.
- [ ] Query keys are operation-specific and allowlisted.
- [ ] Redirects are blocked.
- [ ] Request/response sizes and timeout are bounded.
- [ ] Mutation cannot use stale manifest.
- [ ] Breaking schema version conflicts are explicit.
- [ ] Output schema validation is enforced.
- [ ] Consequential calls enforce approval and readback.
- [ ] Credential binding cannot cross tenant/brand boundaries.
- [ ] Signing private key is not present at edge.
