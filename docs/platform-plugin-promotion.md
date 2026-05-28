# Platform Plugin certification and promotion

## Purpose

Private Platform Plugin contributions can be used by their owner without platform promotion. Promotion is a separate admin-controlled path that makes a certified contribution available through the shared Platform Base.

## Runtime surfaces

- `POST /platform/plugins/contributions/certify`
- `POST /platform/plugins/contributions/promote`

## Certification

Certification validates the contribution manifest, protocol bindings, action bindings, auth type, and credential source metadata. It updates the contribution validation report and certification status, but does not mutate Platform Base.

## Promotion

Promotion requires prior contribution certification and a valid smoke certification for every promoted action binding. The smoke certification must be `certified`, successful, unexpired, status `200`, `response_ok=true`, and `secrets_included=false`.

Promotion writes:

- `app_integrations`
- `app_integration_action_bindings`

Promotion intentionally defaults new Platform Base entries to `beta` unless an admin explicitly requests `active`.

## Boundaries

- Private owner-scoped execution remains independent from promotion.
- Promotion does not copy credentials.
- Promotion does not grant tenant policies automatically.
- Promotion does not grant agent skills automatically.
- Promotion writes execution evidence to `execution_log`.

## Resulting lifecycle

1. Tenant/user creates contribution.
2. Owner can activate and use it privately.
3. Admin certifies it.
4. Admin promotes it to Platform Base.
5. Other tenants/users can discover/install it through normal policy and credential flows.
