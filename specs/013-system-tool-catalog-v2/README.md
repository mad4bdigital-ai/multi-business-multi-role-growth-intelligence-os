# System Tool Catalog V2

This Spec Kit defines a scalable, principal-scoped catalog for governed System Layer tools.

The catalog separates four concerns:

1. bounded catalog browsing with stable cursor snapshots;
2. direct descriptor lookup by stable tool name;
3. intent-to-capability discovery without scanning the first catalog page;
4. runtime callability parity and no-secret observability.

The feature is additive. Existing dispatch, authority, readiness, approval, and readback systems remain canonical. Catalog results never grant execution authority.
