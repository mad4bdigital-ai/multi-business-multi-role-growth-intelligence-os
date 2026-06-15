# Optional Manual Agent Delegation

## Default Contract

Agent delegation is optional and disabled by default. A normal plan may execute through its assigned agent, but workflow output, `linked_workflows`, scheduled jobs, and batch sweeps must not automatically create or dispatch additional agents.

Every sub-agent action requires an explicit authenticated API request containing:

- `delegation_approved=true`;
- `delegation_mode=manual_api`;
- a meaningful `delegation_reason`.

Automatic fallback is also disabled. A single explicitly dispatched chain event may attempt one configured fallback agent only when the same API request includes `allow_fallback_agent=true`.

## Governed API Sequence

Use `https://auth.mad4b.com` with admin list-before-call discovery:

1. `agent_chain_event_create_manual` creates optional chain events from one completed same-tenant workflow run. It does not dispatch an agent.
2. `agent_chain_event_dispatch_manual` dispatches one selected pending event.
3. `agent_delegation_contract_create_manual` creates a user-to-agent delegation contract without executing the agent.

No batch-dispatch tool is exposed through the governed control plane. The internal batch route remains explicit opt-in and must not be scheduled as an automatic sweep.

## Safety Boundaries

- Source workflow run identity and tenant scope are read from the database.
- `linked_workflows` are returned as a `delegation_option`; they do not create chain events automatically.
- Each dispatch still requires healthy-agent resolution, active skill grants, workflow resolution, execution-plan claim, and applicable capability-envelope checks.
- Delegation opt-in does not grant mutation, provider, tool, tenant, budget, or approval authority.
