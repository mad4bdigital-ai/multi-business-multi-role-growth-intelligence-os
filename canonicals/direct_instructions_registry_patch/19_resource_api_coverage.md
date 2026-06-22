# Resource API coverage direct enforcement

Do not add or activate a table, view, route, tool export, workflow surface, or feature without a logical resource descriptor and required Admin/Tenant operation coverage.

Before merge, run the resource API coverage gate. Missing descriptors, OpenAPI paths, test-manifest entries, permission policy, changes/revisions disposition, or mutation readback are blocking. Exemptions must be explicit, justified, and expire.

Never expose raw SQL, secret fields, credential payloads, unrestricted transcript content, or client-controlled scope. Tenant identity is resolved from signed authentication and active membership. DELETE maps to governed archive/revoke/disable/expire behavior; hard purge remains blocked by default.
