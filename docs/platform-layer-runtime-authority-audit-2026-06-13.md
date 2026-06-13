# Platform Layer Runtime Authority Audit

Date: 2026-06-13

## Decision

The platform does not need a replacement execution architecture. The audit correctly identified a runtime wiring gap between mature registries/resolvers and the agent loop. Several earlier recommendations are already implemented by the agent governance runtime and should not be rebuilt.

## Updated Findings

| Report claim | Current decision |
| --- | --- |
| Response profiles missing | Resolved by `agent_response_profile_registry` and `resolveAgentResponseProfile`. |
| Research source policy missing | Resolved by `research_source_policy_registry`, governed research plans, and evidence ledgers. |
| Secure handoff state missing | Resolved by opaque expiring audited handoff state. |
| Memory schema not aligned | Resolved by `memory_scope_state` and deny-by-default runtime resolver. |
| Task/workflow authority not connected to agent loop | Valid. Addressed by `governedAgentExecutionContext.js`. |
| Governed context dependency not wired | Valid. `agentRuntime.js` now supplies `buildGovernedContext`. |
| User request duplicated in system prompt | Valid. Fixed by `agentPromptAssembler.js`; user input remains a user message only. |
| Skill gate is fail-open | Valid and intentionally not changed in this patch. Requires live coverage measurement and risk-class rollout. |
| Tool-loop manifest authorization missing | Valid. Remains a P0 follow-up after observe-only authority evidence is measured. |
| Required output sinks are non-blocking | Valid. Remains a P1 workflow-contract enforcement follow-up. |

## Runtime Authority Bridge

`governedAgentExecutionContext.js` composes:

- task-route authority candidates;
- workflow authority candidates;
- response profile;
- research source policy;
- tenant-bound memory scope.

The bridge defaults to `observe_only`. It exposes explicit route/workflow denials as blockers in the governed context without breaking existing traffic and writes bounded readback-verified drift evidence to authoritative `execution_log`. Setting `AGENT_AUTHORITY_BRIDGE_MODE=enforce` makes those blockers fail closed before model invocation.

The prompt receives only the bounded `prompt_envelope`, not full registry rows or secret-bearing state.

## Rollout Gates

1. Observe route/workflow drift evidence and confirm legitimate traffic is not falsely denied.
2. Enable `enforce` for explicit route/workflow selections.
3. Add per-tool manifest and skill-grant authorization before dispatch.
4. Move write/external/system-control skills to fail-closed after coverage proof.
5. Add required-artifact and side-effect-readback workflow completion gates.

## Verification

Primary targeted proof:

```text
node test-governed-agent-execution-context.mjs
```

The test proves observe-only drift capture, enforce-mode denial, response/research/memory envelope composition, runtime dependency wiring, and separation of user input from the system prompt.
