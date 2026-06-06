# Workspace Google Drive Operating Model

## Goal
Build on Google Drive instead of inventing a custom file manager. The platform keeps authority, metadata, and workflow binding; Drive provides folders, sharing, previews, editing, and file collaboration.

## Workspace vault mapping
Each workspace can have one or more `workspace_vaults` rows. Preferred provider is `google_drive` with provider mode:
- `managed_service_account` for platform-owned folders.
- `shared_drive` for organization-owned shared drives.
- `external_folder` for customer-provided folders.

## Recommended folder structure
Workspace Root
- 00_Admin
- 01_Brand_Core
- 02_Knowledge
- 03_Assets
- 04_Content
- 05_Approvals
- 06_Reports
- 07_Sessions
- 08_App_Exports
- 99_Archive

## Platform metadata
Use `workspace_assets` to map Drive files/folders to platform context:
- tenant_id
- vault_id
- asset_type
- asset_ref (Drive file/folder id)
- brand_ref
- site_ref
- workflow_ref
- session_ref
- visibility
- lifecycle_status

## Authority mapping
Do not rely only on Drive sharing for platform authority. The platform must verify `workspace_resource_grants` before exposing, linking, editing, publishing, or using assets in workflows.

Suggested mapping:
- workspace view -> Drive read/list where appropriate.
- asset edit -> Drive writer/editor where appropriate.
- site operate -> may use approved content assets for publish workflows.
- vault admin -> can bind root folders and repair metadata.

## Daily scenarios

### New workspace
1. Create workspace vault.
2. Create Drive root folder or bind shared drive.
3. Create default folder tree.
4. Insert `workspace_assets` for root folders.
5. Grant owner/admin workspace/vault authority.

### Upload knowledge
1. User adds file to Drive or platform upload stores to Drive.
2. Platform records `workspace_assets` row.
3. Knowledge indexing reads only assets with valid grants.

### Content approval
1. Draft content asset stored under 04_Content.
2. Approval artifact stored under 05_Approvals.
3. Publish workflow checks CMS grant + resource grant + asset authority.

### Session storage
1. Session artifacts stored under 07_Sessions.
2. `workspace_assets.session_ref` links files to GPT/runtime session.

## Guardrails
- Never store raw credentials in Drive.
- Never infer platform permission from Drive sharing alone.
- All workflow reads/writes must pass platform resource authority.
- Service-account access must be auditable through vault and asset rows.
