from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_between(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"{label}:start_marker_missing")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{label}:end_marker_missing")
    return text[:start] + replacement.rstrip() + "\n\n" + text[end:]


def patch_lifecycle() -> None:
    path = ROOT / "routes" / "tenantLifecycleRoutes.js"
    source = path.read_text(encoding="utf-8")

    member_update = r'''  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_member_update
  router.patch("/me/workspaces/:tenant_id/members/:user_id", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const authority = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!authority) return;
      const role = normalizeManagedRole(req.body?.role || "member");
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_member_update
      const [lockedRows] = await connection.query(
        "SELECT user_id, tenant_id, role, status FROM memberships WHERE tenant_id=? AND user_id=? LIMIT 2 FOR UPDATE",
        [req.params.tenant_id, req.params.user_id]
      );
      requireExactlyOneRow(lockedRows, { code: "workspace_member_not_found", message: "Workspace member update must resolve exactly one membership.", status: 404 });
      await assertNotLastOwnerChange(connection, { tenantId: req.params.tenant_id, targetUserId: req.params.user_id, nextRole: role, nextStatus: "active" });
      await connection.query(
        "UPDATE memberships SET role=?, status='active', updated_at=NOW() WHERE tenant_id=? AND user_id=?",
        [role, req.params.tenant_id, req.params.user_id]
      );
      const defaultGrant = await ensureWorkspaceMembershipDefaultGrant(connection, {
        tenantId: req.params.tenant_id,
        userId: req.params.user_id,
        role,
        source: "owner_assignment",
        grantedBy: req.auth.user_id,
      });
      const [readbackRows] = await connection.query(
        "SELECT user_id, tenant_id, role, status, updated_at FROM memberships WHERE tenant_id=? AND user_id=? LIMIT 2",
        [req.params.tenant_id, req.params.user_id]
      );
      const membership = requireExactlyOneRow(readbackRows, { code: "workspace_member_update_readback_invalid", message: "Workspace member update readback must resolve exactly one membership.", status: 409 }); // MUTATION_READBACK: workspace_member_update
      if (membership.role !== role || membership.status !== "active") throw Object.assign(new Error("Workspace member update readback did not match the requested state."), { status: 409, code: "workspace_member_update_readback_mismatch" });
      await connection.commit();
      return res.json({ ok: true, tenant_id: membership.tenant_id, user_id: membership.user_id, role: membership.role, status: membership.status, updated_at: membership.updated_at, default_workspace_grant: defaultGrant, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_member_update_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });'''
    source = replace_between(source, '  router.patch("/me/workspaces/:tenant_id/members/:user_id", requireUserJwt', '  router.post("/me/workspaces/:tenant_id/members/:user_id/remove", requireUserJwt', member_update, "workspace_member_update")

    member_remove = r'''  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_member_remove
  router.post("/me/workspaces/:tenant_id/members/:user_id/remove", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const authority = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!authority) return;
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_member_remove
      const [lockedRows] = await connection.query(
        "SELECT user_id, tenant_id, role, status FROM memberships WHERE tenant_id=? AND user_id=? LIMIT 2 FOR UPDATE",
        [req.params.tenant_id, req.params.user_id]
      );
      requireExactlyOneRow(lockedRows, { code: "workspace_member_not_found", message: "Workspace member removal must resolve exactly one membership.", status: 404 });
      await assertNotLastOwnerChange(connection, { tenantId: req.params.tenant_id, targetUserId: req.params.user_id, nextStatus: "revoked" });
      await connection.query(
        "UPDATE memberships SET status='revoked', updated_at=NOW() WHERE tenant_id=? AND user_id=?",
        [req.params.tenant_id, req.params.user_id]
      );
      await connection.query(
        "UPDATE workspace_resource_grants SET status='revoked', revoked_by=?, revoked_at=NOW(), updated_at=NOW() WHERE tenant_id=? AND grantee_user_id=? AND status='active'",
        [req.auth.user_id, req.params.tenant_id, req.params.user_id]
      );
      const [membershipRows] = await connection.query(
        "SELECT user_id, tenant_id, role, status, updated_at FROM memberships WHERE tenant_id=? AND user_id=? LIMIT 2",
        [req.params.tenant_id, req.params.user_id]
      );
      const membership = requireExactlyOneRow(membershipRows, { code: "workspace_member_remove_readback_invalid", message: "Workspace member removal readback must resolve exactly one membership.", status: 409 });
      const [grantCountRows] = await connection.query(
        "SELECT COUNT(*) AS active_grant_count FROM workspace_resource_grants WHERE tenant_id=? AND grantee_user_id=? AND status='active'",
        [req.params.tenant_id, req.params.user_id]
      );
      const grantCount = requireExactlyOneRow(grantCountRows, { code: "workspace_member_remove_grant_readback_invalid", message: "Workspace grant revocation readback must resolve one count row.", status: 409 }); // MUTATION_READBACK: workspace_member_remove
      if (membership.status !== "revoked" || Number(grantCount.active_grant_count) !== 0) throw Object.assign(new Error("Workspace member removal readback did not reach the revoked state."), { status: 409, code: "workspace_member_remove_readback_mismatch" });
      await connection.commit();
      return res.json({ ok: true, tenant_id: membership.tenant_id, user_id: membership.user_id, status: membership.status, active_grant_count: Number(grantCount.active_grant_count), updated_at: membership.updated_at, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_member_remove_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });'''
    source = replace_between(source, '  router.post("/me/workspaces/:tenant_id/members/:user_id/remove", requireUserJwt', '  router.post("/me/workspaces/:tenant_id/ownership/transfer", requireUserJwt', member_remove, "workspace_member_remove")

    ownership_transfer = r'''  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_ownership_transfer
  router.post("/me/workspaces/:tenant_id/ownership/transfer", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const authority = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!authority) return;
      if (String(authority.role || "").toLowerCase() !== "owner") return res.status(403).json({ ok: false, error: { code: "workspace_owner_transfer_requires_owner", message: "Only an active workspace owner may transfer ownership." }, secrets_included: false });
      const targetUserId = String(req.body?.target_user_id || "").trim();
      if (!targetUserId) return res.status(400).json({ ok: false, error: { code: "target_user_id_required", message: "target_user_id is required." }, secrets_included: false });
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_ownership_transfer
      const [callerRows] = await connection.query("SELECT user_id, tenant_id, role, status FROM memberships WHERE tenant_id=? AND user_id=? LIMIT 2 FOR UPDATE", [req.params.tenant_id, req.auth.user_id]);
      const caller = requireExactlyOneRow(callerRows, { code: "workspace_owner_not_found", message: "Ownership transfer caller must resolve exactly one membership.", status: 403 });
      if (caller.role !== "owner" || caller.status !== "active") throw Object.assign(new Error("Only an active workspace owner may transfer ownership."), { status: 403, code: "workspace_owner_transfer_requires_owner" });
      const [targetRows] = await connection.query("SELECT user_id, tenant_id, role, status FROM memberships WHERE tenant_id=? AND user_id=? AND status='active' LIMIT 2 FOR UPDATE", [req.params.tenant_id, targetUserId]);
      requireExactlyOneRow(targetRows, { code: "target_member_not_found", message: "Target user must resolve exactly one active workspace membership.", status: 404 });
      await connection.query("UPDATE memberships SET role='owner', updated_at=NOW() WHERE tenant_id=? AND user_id=?", [req.params.tenant_id, targetUserId]);
      const targetGrant = await ensureWorkspaceMembershipDefaultGrant(connection, { tenantId: req.params.tenant_id, userId: targetUserId, role: "owner", source: "owner_assignment", grantedBy: req.auth.user_id });
      const demotePreviousOwner = req.body?.demote_current_owner !== false && targetUserId !== req.auth.user_id;
      let previousOwnerGrant = null;
      if (demotePreviousOwner) {
        await connection.query("UPDATE memberships SET role='admin', updated_at=NOW() WHERE tenant_id=? AND user_id=? AND role='owner' AND status='active'", [req.params.tenant_id, req.auth.user_id]);
        previousOwnerGrant = await ensureWorkspaceMembershipDefaultGrant(connection, { tenantId: req.params.tenant_id, userId: req.auth.user_id, role: "admin", source: "owner_assignment", grantedBy: req.auth.user_id });
      }
      const [targetReadbackRows] = await connection.query("SELECT user_id, tenant_id, role, status, updated_at FROM memberships WHERE tenant_id=? AND user_id=? LIMIT 2", [req.params.tenant_id, targetUserId]);
      const targetMembership = requireExactlyOneRow(targetReadbackRows, { code: "workspace_ownership_transfer_readback_invalid", message: "New owner readback must resolve exactly one membership.", status: 409 });
      let previousMembership = null;
      if (demotePreviousOwner) {
        const [previousRows] = await connection.query("SELECT user_id, tenant_id, role, status, updated_at FROM memberships WHERE tenant_id=? AND user_id=? LIMIT 2", [req.params.tenant_id, req.auth.user_id]);
        previousMembership = requireExactlyOneRow(previousRows, { code: "workspace_previous_owner_readback_invalid", message: "Previous owner readback must resolve exactly one membership.", status: 409 });
      }
      if (targetMembership.role !== "owner" || targetMembership.status !== "active" || (previousMembership && previousMembership.role !== "admin")) throw Object.assign(new Error("Ownership transfer readback did not match the requested state."), { status: 409, code: "workspace_ownership_transfer_readback_mismatch" }); // MUTATION_READBACK: workspace_ownership_transfer
      await connection.commit();
      return res.json({ ok: true, tenant_id: targetMembership.tenant_id, previous_owner_user_id: demotePreviousOwner ? req.auth.user_id : null, new_owner_user_id: targetMembership.user_id, demoted_previous_owner: demotePreviousOwner, new_owner_membership: targetMembership, previous_owner_membership: previousMembership, new_owner_grant: targetGrant, previous_owner_grant: previousOwnerGrant, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_ownership_transfer_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });'''
    source = replace_between(source, '  router.post("/me/workspaces/:tenant_id/ownership/transfer", requireUserJwt', '  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_invitation_create', ownership_transfer, "workspace_ownership_transfer")

    invitation_revoke = r'''  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_invitation_revoke
  router.post("/me/workspaces/:tenant_id/invitations/:invitation_id/revoke", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const authority = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!authority) return;
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_invitation_revoke
      const [rows] = await connection.query("SELECT invitation_id, tenant_id, status FROM invitations WHERE tenant_id=? AND invitation_id=? LIMIT 2 FOR UPDATE", [req.params.tenant_id, req.params.invitation_id]);
      const invitation = requireExactlyOneRow(rows, { code: "workspace_invitation_not_found", message: "Invitation revoke must resolve exactly one invitation.", status: 404 });
      if (invitation.status !== "pending") throw Object.assign(new Error("Only pending invitations may be revoked."), { status: 409, code: "workspace_invitation_not_pending" });
      const [result] = await connection.query("UPDATE invitations SET status='revoked', revoked_by=?, revoked_at=NOW(), updated_at=NOW() WHERE tenant_id=? AND invitation_id=? AND status='pending'", [req.auth.user_id, req.params.tenant_id, req.params.invitation_id]);
      if (result.affectedRows !== 1) throw Object.assign(new Error("Invitation revoke lost its pending state."), { status: 409, code: "workspace_invitation_state_changed" });
      const [readbackRows] = await connection.query("SELECT invitation_id, tenant_id, status, revoked_by, revoked_at, updated_at FROM invitations WHERE tenant_id=? AND invitation_id=? LIMIT 2", [req.params.tenant_id, req.params.invitation_id]);
      const revoked = requireExactlyOneRow(readbackRows, { code: "workspace_invitation_revoke_readback_invalid", message: "Invitation revoke readback must resolve exactly one invitation.", status: 409 }); // MUTATION_READBACK: workspace_invitation_revoke
      if (revoked.status !== "revoked") throw Object.assign(new Error("Invitation revoke readback did not reach revoked state."), { status: 409, code: "workspace_invitation_revoke_readback_mismatch" });
      await connection.commit();
      return res.json({ ok: true, tenant_id: revoked.tenant_id, invitation_id: revoked.invitation_id, status: revoked.status, revoked_by: revoked.revoked_by, revoked_at: revoked.revoked_at, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_invitation_revoke_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });'''
    source = replace_between(source, '  router.post("/me/workspaces/:tenant_id/invitations/:invitation_id/revoke", requireUserJwt', '  router.post("/me/workspaces/:tenant_id/invitations/:invitation_id/resend", requireUserJwt', invitation_revoke, "workspace_invitation_revoke")

    invitation_resend = r'''  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_invitation_resend
  router.post("/me/workspaces/:tenant_id/invitations/:invitation_id/resend", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const authority = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!authority) return;
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_invitation_resend
      const [rows] = await connection.query("SELECT invitation_id, tenant_id, email, role, status FROM invitations WHERE tenant_id=? AND invitation_id=? LIMIT 2 FOR UPDATE", [req.params.tenant_id, req.params.invitation_id]);
      const invitation = requireExactlyOneRow(rows, { code: "workspace_invitation_not_found", message: "Invitation resend must resolve exactly one invitation.", status: 404 });
      if (!["pending", "expired", "revoked"].includes(invitation.status)) throw Object.assign(new Error("Invitation state does not permit resend."), { status: 409, code: "workspace_invitation_resend_not_allowed" });
      const token = randomBytes(32).toString("hex");
      const [result] = await connection.query("UPDATE invitations SET token=?, status='pending', created_by=?, expires_at=DATE_ADD(NOW(), INTERVAL 14 DAY), revoked_by=NULL, revoked_at=NULL, updated_at=NOW() WHERE tenant_id=? AND invitation_id=? AND status IN ('pending','expired','revoked')", [token, req.auth.user_id, req.params.tenant_id, req.params.invitation_id]);
      if (result.affectedRows !== 1) throw Object.assign(new Error("Invitation resend state changed concurrently."), { status: 409, code: "workspace_invitation_state_changed" });
      const [readbackRows] = await connection.query("SELECT invitation_id, tenant_id, email, role, status, expires_at, created_by, updated_at FROM invitations WHERE tenant_id=? AND invitation_id=? LIMIT 2", [req.params.tenant_id, req.params.invitation_id]);
      const resent = requireExactlyOneRow(readbackRows, { code: "workspace_invitation_resend_readback_invalid", message: "Invitation resend readback must resolve exactly one invitation.", status: 409 }); // MUTATION_READBACK: workspace_invitation_resend
      if (resent.status !== "pending") throw Object.assign(new Error("Invitation resend readback did not reach pending state."), { status: 409, code: "workspace_invitation_resend_readback_mismatch" });
      await connection.commit();
      return res.json({ ok: true, tenant_id: resent.tenant_id, invitation: resent, token_returned: false, delivery_required: true, expires_in_days: 14, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_invitation_resend_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });'''
    source = replace_between(source, '  router.post("/me/workspaces/:tenant_id/invitations/:invitation_id/resend", requireUserJwt', '  router.post("/me/workspaces/:tenant_id/invitations/expire-stale", requireUserJwt', invitation_resend, "workspace_invitation_resend")

    invitation_expire = r'''  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_invitations_expire_stale
  router.post("/me/workspaces/:tenant_id/invitations/expire-stale", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const authority = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!authority) return;
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_invitations_expire_stale
      const [result] = await connection.query("UPDATE invitations SET status='expired', updated_at=NOW() WHERE tenant_id=? AND status='pending' AND expires_at < NOW()", [req.params.tenant_id]);
      const [readbackRows] = await connection.query("SELECT COUNT(*) AS stale_pending_count FROM invitations WHERE tenant_id=? AND status='pending' AND expires_at < NOW()", [req.params.tenant_id]);
      const readback = requireExactlyOneRow(readbackRows, { code: "workspace_invitations_expire_readback_invalid", message: "Expired invitation readback must resolve one count row.", status: 409 }); // MUTATION_READBACK: workspace_invitations_expire_stale
      if (Number(readback.stale_pending_count) !== 0) throw Object.assign(new Error("Expired invitation readback still contains stale pending invitations."), { status: 409, code: "workspace_invitations_expire_readback_mismatch" });
      await connection.commit();
      return res.json({ ok: true, tenant_id: req.params.tenant_id, expired_count: result.affectedRows || 0, stale_pending_count: Number(readback.stale_pending_count), secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_invitations_expire_stale_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });'''
    source = replace_between(source, '  router.post("/me/workspaces/:tenant_id/invitations/expire-stale", requireUserJwt', '  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_invitations_list', invitation_expire, "workspace_invitations_expire_stale")

    if "RESOURCE_API_CALLABILITY_CONTRACT: workspace_my_access_requests_list" not in source:
        marker = '  router.get("/me/access-requests", requireUserJwt'
        if source.count(marker) != 1:
            raise SystemExit(f"workspace_my_access_requests_list:route_count:{source.count(marker)}")
        source = source.replace(marker, "  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_my_access_requests_list\n" + marker, 1)

    access_cancel = r'''  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_access_request_cancel
  router.post("/me/workspaces/:tenant_id/access-requests/:request_id/cancel", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_access_request_cancel
      const [requestRows] = await connection.query("SELECT request_id, tenant_id, requester_user_id, status FROM workspace_access_requests WHERE request_id=? AND tenant_id=? AND requester_user_id=? LIMIT 2 FOR UPDATE", [req.params.request_id, req.params.tenant_id, req.auth.user_id]);
      const request = requireExactlyOneRow(requestRows, { code: "workspace_access_request_not_found", message: "Access request cancel must resolve exactly one requester-owned request.", status: 404 });
      if (request.status !== "pending") throw Object.assign(new Error("Only pending access requests may be cancelled."), { status: 409, code: "workspace_access_request_not_pending" });
      const [result] = await connection.query("UPDATE workspace_access_requests SET status='cancelled', updated_at=NOW() WHERE request_id=? AND tenant_id=? AND requester_user_id=? AND status='pending'", [req.params.request_id, req.params.tenant_id, req.auth.user_id]);
      if (result.affectedRows !== 1) throw Object.assign(new Error("Access request cancellation lost its pending state."), { status: 409, code: "workspace_access_request_state_changed" });
      const [readbackRows] = await connection.query("SELECT request_id, tenant_id, requester_user_id, status, updated_at FROM workspace_access_requests WHERE request_id=? AND tenant_id=? LIMIT 2", [req.params.request_id, req.params.tenant_id]);
      const cancelled = requireExactlyOneRow(readbackRows, { code: "workspace_access_request_cancel_readback_invalid", message: "Access request cancel readback must resolve exactly one request.", status: 409 }); // MUTATION_READBACK: workspace_access_request_cancel
      if (cancelled.status !== "cancelled" || cancelled.requester_user_id !== req.auth.user_id) throw Object.assign(new Error("Access request cancel readback did not match the requester-owned cancelled state."), { status: 409, code: "workspace_access_request_cancel_readback_mismatch" });
      await connection.commit();
      return res.json({ ok: true, request_id: cancelled.request_id, tenant_id: cancelled.tenant_id, status: cancelled.status, updated_at: cancelled.updated_at, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_access_request_cancel_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });'''
    source = replace_between(source, '  router.post("/me/workspaces/:tenant_id/access-requests/:request_id/cancel", requireUserJwt', '  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_access_request_create', access_cancel, "workspace_access_request_cancel")

    path.write_text(source, encoding="utf-8")


def patch_resources() -> None:
    path = ROOT / "routes" / "workspaceResourceRoutes.js"
    source = path.read_text(encoding="utf-8")

    create_grant = r'''  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_resource_grant_create
  router.post("/me/workspaces/:tenant_id/resource-grants", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const authority = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!authority) return;
      const granteeUserId = String(req.body?.grantee_user_id || "").trim();
      const resourceType = normalizeResourceType(req.body?.resource_type);
      const resourceRef = normalizeResourceRef(req.body?.resource_ref || (resourceType === "workspace" ? req.params.tenant_id : ""));
      const permission = normalizePermission(req.body?.permission || "view");
      if (!granteeUserId) return res.status(400).json({ ok: false, error: { code: "grantee_user_id_required", message: "grantee_user_id is required." }, secrets_included: false });
      if (!resourceType) return res.status(400).json({ ok: false, error: { code: "invalid_resource_type", message: "Valid resource_type is required." }, secrets_included: false });
      if (!resourceRef) return res.status(400).json({ ok: false, error: { code: "resource_ref_required", message: "resource_ref is required." }, secrets_included: false });
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_resource_grant_create
      const [memberRows] = await connection.query("SELECT user_id, role, status FROM memberships WHERE tenant_id=? AND user_id=? AND status='active' LIMIT 2 FOR UPDATE", [req.params.tenant_id, granteeUserId]);
      if (memberRows.length !== 1) throw Object.assign(new Error("Grantee must resolve exactly one active workspace membership."), { status: 403, code: "grantee_membership_required" });
      const candidateGrantId = randomUUID();
      await connection.query(
        `INSERT INTO workspace_resource_grants (grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, expires_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 'owner_assignment', ?, ?, ?)
         ON DUPLICATE KEY UPDATE status='active', permission=VALUES(permission), granted_by=VALUES(granted_by), expires_at=VALUES(expires_at), metadata_json=VALUES(metadata_json), revoked_by=NULL, revoked_at=NULL, updated_at=NOW()`,
        [candidateGrantId, req.params.tenant_id, granteeUserId, resourceType, resourceRef, permission, req.auth.user_id, req.body?.expires_at || null, jsonMeta(req.body?.metadata_json)]
      );
      const [readbackRows] = await connection.query(
        "SELECT grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, expires_at, updated_at FROM workspace_resource_grants WHERE tenant_id=? AND grantee_user_id=? AND resource_type=? AND resource_ref=? AND permission=? AND status='active' ORDER BY updated_at DESC LIMIT 2",
        [req.params.tenant_id, granteeUserId, resourceType, resourceRef, permission]
      );
      if (readbackRows.length !== 1) throw Object.assign(new Error("Workspace resource grant readback must resolve exactly one active grant."), { status: 409, code: "workspace_resource_grant_create_readback_invalid" }); // MUTATION_READBACK: workspace_resource_grant_create
      const grant = readbackRows[0];
      await connection.commit();
      return res.status(201).json({ ok: true, tenant_id: grant.tenant_id, grant, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_resource_grant_create_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });'''
    source = replace_between(source, '  router.post("/me/workspaces/:tenant_id/resource-grants", requireUserJwt', '  router.post("/me/workspaces/:tenant_id/resource-grants/:grant_id/revoke", requireUserJwt', create_grant, "workspace_resource_grant_create")

    revoke_grant = r'''  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_resource_grant_revoke
  router.post("/me/workspaces/:tenant_id/resource-grants/:grant_id/revoke", requireUserJwt, async (req, res) => {
    const connection = await getPool().getConnection();
    try {
      const authority = await requireWorkspaceOwner(req, res, req.params.tenant_id);
      if (!authority) return;
      await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_resource_grant_revoke
      const [lockedRows] = await connection.query("SELECT grant_id, tenant_id, status FROM workspace_resource_grants WHERE tenant_id=? AND grant_id=? LIMIT 2 FOR UPDATE", [req.params.tenant_id, req.params.grant_id]);
      if (lockedRows.length !== 1) throw Object.assign(new Error("Workspace resource grant was not found."), { status: 404, code: "workspace_resource_grant_not_found" });
      if (lockedRows[0].status !== "active") throw Object.assign(new Error("Only active grants may be revoked."), { status: 409, code: "workspace_resource_grant_not_active" });
      const [result] = await connection.query("UPDATE workspace_resource_grants SET status='revoked', revoked_by=?, revoked_at=NOW(), updated_at=NOW() WHERE tenant_id=? AND grant_id=? AND status='active'", [req.auth.user_id, req.params.tenant_id, req.params.grant_id]);
      if (result.affectedRows !== 1) throw Object.assign(new Error("Workspace resource grant revoke lost its active state."), { status: 409, code: "workspace_resource_grant_state_changed" });
      const [readbackRows] = await connection.query("SELECT grant_id, tenant_id, status, revoked_by, revoked_at, updated_at FROM workspace_resource_grants WHERE tenant_id=? AND grant_id=? LIMIT 2", [req.params.tenant_id, req.params.grant_id]);
      if (readbackRows.length !== 1 || readbackRows[0].status !== "revoked") throw Object.assign(new Error("Workspace resource grant revoke readback did not reach revoked state."), { status: 409, code: "workspace_resource_grant_revoke_readback_invalid" }); // MUTATION_READBACK: workspace_resource_grant_revoke
      const grant = readbackRows[0];
      await connection.commit();
      return res.json({ ok: true, tenant_id: grant.tenant_id, grant_id: grant.grant_id, status: grant.status, revoked_by: grant.revoked_by, revoked_at: grant.revoked_at, secrets_included: false });
    } catch (err) {
      await connection.rollback();
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "workspace_resource_grant_revoke_failed", message: err.message }, secrets_included: false });
    } finally {
      connection.release();
    }
  });'''
    source = replace_between(source, '  router.post("/me/workspaces/:tenant_id/resource-grants/:grant_id/revoke", requireUserJwt', '  router.get("/me/workspaces/:tenant_id/assets", requireUserJwt', revoke_grant, "workspace_resource_grant_revoke")

    path.write_text(source, encoding="utf-8")


patch_lifecycle()
patch_resources()
print("workspace lifecycle and resource grant patches applied")
