# Tenant Asset Federation and Editable Overlays

**Status:** Review open  
**Pull request:** `#1898`  
**Branch:** `gpt/004-tenant-asset-federation-20260623`  
**Implementation authorized:** No

This Spec Kit defines a tenant self-service model for adopting platform-base assets and creating tenant-owned editable versions of:

- agents;
- skills;
- policies;
- workflows;
- apps and plugins;
- actions and tools;
- logic and engine configurations;
- future registered asset types.

The effective tenant configuration may be composed across tenant, workspace, brand, business-activity-type, and role scopes. The user selects `union` or `intersection` composition per profile or asset family.

Platform-base assets remain immutable. Tenant assets are copy-on-write overlays or detached forks. Credentials remain outside asset content and are supplied through governed tenant credential intake or OAuth connection flows.

This package is design-only. It performs no migration, credential mutation, provider call, grant activation, installation activation, or external write.
