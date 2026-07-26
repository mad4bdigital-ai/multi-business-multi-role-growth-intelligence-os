# Acceptance Matrix

## A. Selector and parity

| ID | Scenario | Expected |
|---|---|---|
| A01 | action selector only | Resolves one canonical capability |
| A02 | tool selector only for same capability | Same canonical capability and minimum gates |
| A03 | action + tool supplied | 400 `AMBIGUOUS_CAPABILITY_SELECTOR` |
| A04 | no selector | 400 `MISSING_CAPABILITY_SELECTOR` |
| A05 | unknown selector | 404 `CAPABILITY_NOT_FOUND` |
| A06 | alias maps to multiple active capabilities | Deny; registry integrity alert |
| A07 | surface policy weaker than canonical | Deny `SURFACE_POLICY_MISMATCH` |
| A08 | dual-surface inventory parity scan | Zero mismatches |

## B. Principal and surface

| ID | Scenario | Expected |
|---|---|---|
| B01 | platform admin → admin capability | Evaluated under admin policy |
| B02 | tenant admin → tenant-safe capability | May proceed if all gates pass |
| B03 | tenant admin → platform-admin tool | 403 before credential resolution |
| B04 | tenant member → tenant-admin-only mutation | Denied |
| B05 | principal without tenant membership | Denied |
| B06 | caller supplies another tenant ID | Ignored/rejected; auth context remains authority |
| B07 | foreign resource ID | Public-safe 404/403; no existence leak |

## C. Gate completeness

| ID | Scenario | Expected |
|---|---|---|
| C01 | required gate `not_evaluated` | Final deny; `dispatchReady=false` |
| C02 | optional gate not applicable | May allow if all required gates pass |
| C03 | explicit tool selector | Never classified as `no_action_requested` |
| C04 | missing policy | Deny `POLICY_NOT_FOUND` |
| C05 | state-changing capability lacks mutation policy | Deny |
| C06 | preview mode | `willExecute=false`, no side effects |
| C07 | execute mode with all gates passing | `dispatchReady=true`; governed execution may occur |

## D. Credentials

| ID | Scenario | Expected |
|---|---|---|
| D01 | no-secret capability, unauthorized subject | Denied despite `not_required` |
| D02 | credential required and valid | Usable after authorization passes |
| D03 | credential missing | Denied/missing |
| D04 | `pending_validation` | Unusable for execution |
| D05 | revoked | Unusable |
| D06 | wrong tenant | Denied without secret lookup leakage |
| D07 | wrong plugin/scope | `CREDENTIAL_SCOPE_MISMATCH` |
| D08 | platform-managed credential, unauthorized target | Denied |
| D09 | response/audit inspection | No secret material |

## E. Secure intake

| ID | Scenario | Expected |
|---|---|---|
| E01 | tenant admin, allowed integration | Create bounded session |
| E02 | tenant member without grant | Denied |
| E03 | raw admin intake tool from tenant | Denied |
| E04 | foreign connection target | Denied |
| E05 | unapproved redirect | 400 |
| E06 | expired session | Cannot consume |
| E07 | consumed session replay | `INTAKE_SESSION_REPLAYED` |
| E08 | membership revoked after creation | Session invalidated |
| E09 | audit inspection | Create/consume events; no secrets |

## F. Device trust

| ID | Scenario | Expected |
|---|---|---|
| F01 | no device ID | `DEVICE_ID_REQUIRED` |
| F02 | random device ID | Public-safe denial |
| F03 | foreign tenant device | Denied |
| F04 | archived/revoked device | Denied |
| F05 | valid registration, stale heartbeat | `DEVICE_HEARTBEAT_STALE` |
| F06 | offline device | `DEVICE_OFFLINE` |
| F07 | connector identity mismatch | Denied |
| F08 | unsupported capability | `TARGET_NOT_SUPPORTED` |
| F09 | valid skill but invalid device | Denied |
| F10 | local consent required and absent | Denied |
| F11 | valid device and consent | Eligible only if all other gates pass |

## G. Local shell/files

| ID | Scenario | Expected |
|---|---|---|
| G01 | arbitrary command | Denied |
| G02 | allowlisted command, valid typed args | Evaluated normally |
| G03 | shell metacharacter injection | Schema rejection |
| G04 | path traversal | Denied |
| G05 | symlink escape | Denied |
| G06 | read allowed, write not allowed | Write denied |
| G07 | secret path | Denied and redacted |
| G08 | oversized output | Truncated/bounded with audit |

## H. Approval and mutation

| ID | Scenario | Expected |
|---|---|---|
| H01 | state-changing, approval absent | Denied |
| H02 | approval for different capability | Denied |
| H03 | approval for different target | Denied |
| H04 | approval from wrong approver role | Denied |
| H05 | expired approval | Denied |
| H06 | consumed approval replay | Denied |
| H07 | valid bounded approval | May execute once |
| H08 | execution success | Same-cycle readback recorded |
| H09 | execution failure | Stable error, audit, no false success |

## I. Integration-specific

| ID | Scenario | Expected |
|---|---|---|
| I01 | Cloudflare zone owned by tenant | Evaluate record policy |
| I02 | foreign Cloudflare zone | Denied |
| I03 | protected root/auth record mutation | Denied or elevated approval |
| I04 | Cloudflare delete without readback/rollback metadata | Denied |
| I05 | n8n read | Separate read permission |
| I06 | n8n run/activate | Mutation policy and instance ownership required |
| I07 | local n8n vs managed instance mismatch | Denied |

## J. Status and audit

| ID | Scenario | Expected |
|---|---|---|
| J01 | workspace active, device registered, no live signal | Not reported healthy |
| J02 | current healthy heartbeat | Health may be healthy |
| J03 | credential pending | Execution readiness blocked |
| J04 | every preview | Decision trace exists |
| J05 | every execution attempt | Decision and outcome trace exists |
| J06 | denied at early gate | Later gates show `not_evaluated`, not false pass |
| J07 | allowed decision | All required gates pass |
| J08 | trace redaction scan | No secrets |
