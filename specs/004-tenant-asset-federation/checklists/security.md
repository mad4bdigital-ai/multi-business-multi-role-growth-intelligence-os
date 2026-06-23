# Security Checklist

- [x] Signed principal is tenant authority.
- [x] Client tenant overrides are forbidden.
- [x] Platform-control-plane assets can be excluded from adoption.
- [x] Mandatory platform policy cannot be weakened.
- [x] Union mode cannot bypass execution gates.
- [x] Intersection mode fails closed on missing evidence.
- [x] Raw secrets are forbidden in asset versions, logs, and responses.
- [x] Credential binding uses opaque references.
- [x] Equal-ranked ambiguity blocks resolution.
- [x] Cross-tenant references are forbidden.
- [x] Consequential writes retain approval, quota, audit, and readback gates.
- [x] Delegated grants cannot exceed the grantor's authority.
- [ ] Threat model reviewed before implementation.
- [ ] Migration security review completed.
