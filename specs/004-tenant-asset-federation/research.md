# Research Findings

## Current strengths

The repository already has useful specialized authorities:

- `agent_skills` and `agent_skill_grants`;
- `agent_workflow_bindings`;
- `app_integrations`;
- `app_action_grants`;
- `workspace_resource_grants`;
- `entitlements`;
- `connected_systems` and `installations`;
- semantic capability, connection, approval, policy, and certification layers.

## Current gaps

1. `agent_workflow_bindings` has no tenant/workspace/brand/activity/role scope.
2. `agent_skill_grants` supports tenant and brand but not workspace, activity type, or role composition.
3. `app_action_grants` is connection/workspace/agent-specific but does not provide tenant-owned editable action definitions.
4. `workspace_resource_grants` controls access but does not define asset inheritance/versioning.
5. `app_integrations`, workflows, actions, policies, agents, and skills are global definitions without a generic tenant overlay/fork authority.
6. Credential and installation evidence is separate but current UI counts can obscure the distinction.
7. Existing active approval-sensitive grants are not equivalent to pending approval requests.

## Live evidence reviewed

- 31 registered connected systems resolve to 3 operationally active and 28 pending because only 3 active installation rows exist.
- Of the 28 pending, 23 have registry status `active` but no installation evidence; 5 are registry `pending`.
- Ten skill grants are active grants to approval-sensitive skills. They are not ten pending approval requests.
- Four open approval holds exist, but none is directly linked to those ten grants by skill or agent identifier.

## Design conclusion

A generic tenant asset federation layer is preferable to adding more asset-specific grant tables. It should bridge existing authorities first, run in read-only shadow mode, and become runtime authority only after parity certification.

## Open implementation dependency

PR `#1894` introduces a governed Resource API coverage layer and changes canonical/template surfaces. Implementation planning must rebase on the state of that PR and reuse its resource architecture where compatible. This Spec Kit intentionally avoids changing those files.
