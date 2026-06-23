# Permissions Matrix

| Operation | Platform base | Tenant instance | Default eligible role | Extra gate |
|---|---|---|---|---|
| View catalog | Read-only | Read-only | tenant member | entitlement/scope |
| Adopt | Never modifies base | Creates instance | tenant owner/admin | adoption policy |
| Edit | Forbidden | New draft version | asset editor/admin | edit grant |
| Publish version | Forbidden | Activates tenant version | tenant admin/publisher | validation/readback |
| Grant use | Forbidden | Scope binding/grant | tenant admin/grant manager | no cross-tenant ref |
| Configure credentials | Forbidden | Connection binding only | tenant owner/integration admin | credential intake/OAuth |
| Execute read action | Base definition only | Effective instance | operator/agent | readiness vector |
| Execute write action | Base definition only | Effective instance | operator/agent | approval/policy/resource authority |
| Upgrade overlay | N/A | Rebase/import | tenant admin/editor | conflict review |
| Roll back | N/A | Previous tenant version | tenant admin | audit/readback |
| Archive | Platform governance only | Tenant-owned instance | tenant admin | dependency check |

## Policy editing

Tenant-editable policy versions may:

- add restrictions;
- narrow scopes;
- lower quotas;
- increase approval requirements;
- add tenant-specific validators.

They may not weaken mandatory platform safety, tenant isolation, credential, approval, audit, readback, destructive-operation, or secret-handling rules.

## Grant delegation

A user may grant only permissions they hold with delegation rights. `edit` does not imply `grant`; `grant` does not imply `execute`; `configure_credentials` does not imply the right to read credential values.

## Sensitive assets

Approval-sensitive skills and actions may be adopted and edited, but every invocation still evaluates the approval gate. Their presence in an active grant must be labeled `approval_sensitive_active_grant`, not `pending_approval_request`.
