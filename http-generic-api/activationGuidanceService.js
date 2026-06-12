import { getPool } from "./db.js";
import {
  buildGuidancePresentation,
  resolveGuidanceLanguagePreference,
} from "./activationGuidancePresentation.js";

const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|authorization|cookie|set-cookie|installer|raw_token)/i;
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function stripSensitive(value) {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
      .map(([key, item]) => [key, stripSensitive(item)])
  );
}

async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return Array.isArray(rows) ? rows : [];
}

async function tableExists(tableName) {
  const rows = await query(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [tableName]
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function countWhere(tableName, where = "1=1", params = []) {
  if (!(await tableExists(tableName))) return 0;
  const rows = await query(`SELECT COUNT(*) AS count FROM \`${tableName}\` WHERE ${where}`, params);
  return Number(rows[0]?.count || 0);
}

async function fetchTenantContext({ userId, tenantId }) {
  if (!userId || !(await tableExists("memberships"))) return null;
  const params = [userId];
  let tenantClause = "";
  if (tenantId) {
    tenantClause = "AND m.tenant_id = ?";
    params.push(tenantId);
  }
  const rows = await query(
    `SELECT m.tenant_id, m.role, m.status, t.display_name, t.tenant_type, t.status AS tenant_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ?
        AND m.status = 'active'
        AND t.status = 'active'
        ${tenantClause}
      ORDER BY m.granted_at ASC
      LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function fetchAdminTenantContext({ tenantId }) {
  if (!tenantId || !(await tableExists("tenants"))) return null;
  const rows = await query(
    `SELECT tenant_id, display_name, tenant_type, status AS tenant_status
       FROM tenants
      WHERE tenant_id = ?
      LIMIT 1`,
    [tenantId]
  );
  return rows[0] || null;
}

async function readToolRows(tableName, where, params) {
  if (!(await tableExists(tableName))) return [];
  return query(
    `SELECT tool_key, display_name, http_method, http_path, tags, is_enabled, sort_order
       FROM \`${tableName}\`
      WHERE ${where}
      ORDER BY sort_order ASC, tool_key ASC
      LIMIT 500`,
    params
  );
}

function classifyTools(rows) {
  let readOnly = 0;
  let previewOnly = 0;
  let approvalRequired = 0;
  let stateChanging = 0;
  let highRiskVisible = 0;
  let operationalGuidance = 0;
  const safeMenu = [];
  const blockedOrLimited = [];
  for (const row of rows) {
    const method = String(row.http_method || "").toUpperCase();
    const tags = String(row.tags || "").toLowerCase();
    const isRead = READ_METHODS.has(method) || tags.includes("read_only");
    const isPreview = tags.includes("preview") || tags.includes("dry_run");
    const needsApproval = tags.includes("approval") || tags.includes("capability_envelope") || tags.includes("execution_gated") || tags.includes("state_changing");
    const isStateChanging = !isRead || tags.includes("state_changing") || tags.includes("external_write") || tags.includes("destructive");
    const highRisk = tags.includes("destructive") || tags.includes("external_write") || tags.includes("shell") || tags.includes("repo_patch") || tags.includes("state_changing");
    if (isRead) readOnly += 1;
    if (isPreview) previewOnly += 1;
    if (needsApproval) approvalRequired += 1;
    if (isStateChanging) stateChanging += 1;
    if (highRisk) highRiskVisible += 1;
    if (tags.includes("activation-guidance") || tags.includes("operational-console")) operationalGuidance += 1;
    if (isRead && safeMenu.length < 12) {
      safeMenu.push({ tool_key: row.tool_key, display_name: row.display_name, method, reason: "read_only_or_safe_status_surface" });
    }
    if ((needsApproval || highRisk) && blockedOrLimited.length < 12) {
      blockedOrLimited.push({
        tool_key: row.tool_key,
        display_name: row.display_name,
        method,
        classification: highRisk ? "high_risk_or_mutating" : "approval_required",
        user_facing_status: "available_only_after_resolution_or_approval",
      });
    }
  }
  return { readOnly, previewOnly, approvalRequired, stateChanging, highRiskVisible, operationalGuidance, safeMenu, blockedOrLimited };
}

async function buildCounts({ profile, userId, tenantId }) {
  const tenantToolRows = await readToolRows("tenant_platform_endpoint_tools", "is_enabled = 1", []);
  const adminToolRows = profile === "admin" ? await readToolRows("admin_platform_endpoint_tools", "is_enabled = 1", []) : [];
  const toolRows = profile === "admin" ? adminToolRows : tenantToolRows;
  const classified = classifyTools(toolRows);

  const localWhere = tenantId && userId
    ? "tenant_id = ? AND user_id = ?"
    : tenantId
      ? "tenant_id = ?"
      : userId
        ? "user_id = ?"
        : "1=1";
  const localParams = tenantId && userId ? [tenantId, userId] : tenantId ? [tenantId] : userId ? [userId] : [];

  const connectedWhere = tenantId ? "tenant_id = ?" : "1=1";
  const connectedParams = tenantId ? [tenantId] : [];

  const membershipWhere = tenantId ? "tenant_id = ? AND status = 'active'" : userId ? "user_id = ? AND status = 'active'" : "status = 'active'";
  const membershipParams = tenantId ? [tenantId] : userId ? [userId] : [];

  return {
    workspaces_or_tenants: await countWhere("tenants", "status = 'active'", []),
    active_memberships: await countWhere("memberships", membershipWhere, membershipParams),
    devices_registered: await countWhere("local_connector_user_configs", localWhere, localParams),
    devices_active: await countWhere("local_connector_user_configs", `${localWhere} AND is_enabled = 1`, localParams),
    connected_apps: await countWhere("connected_systems", connectedWhere, connectedParams),
    connected_apps_active: await countWhere("connected_systems", `${connectedWhere} AND status = 'active'`, connectedParams),
    tenant_safe_tools: tenantToolRows.length,
    admin_tools: profile === "admin" ? adminToolRows.length : 0,
    resolved_allowed_tools: classified.readOnly + classified.previewOnly,
    read_only_actions: classified.readOnly,
    preview_actions: classified.previewOnly,
    approval_required_actions: classified.approvalRequired,
    state_changing_or_high_risk_visible: classified.highRiskVisible,
    blocked_or_limited_tools: classified.blockedOrLimited.length,
    operational_guidance_tools: classified.operationalGuidance,
    brands_total: profile === "admin" ? await countWhere("brands", "1=1", []) : 0,
    brands_active: profile === "admin" ? await countWhere("brands", "LOWER(COALESCE(status,'')) LIKE '%active%'", []) : 0,
  };
}

function buildCapabilityGroups({ profile, counts }) {
  const groups = [
    {
      group: "activation_guidance",
      ready: true,
      count: counts.operational_guidance_tools,
      best_next_action: "read_activation_guidance_brief",
      reason: "guidance_layer_available_for_summary_counts_permissions_and_next_best_action",
    },
    {
      group: "local_device",
      ready: counts.devices_active > 0,
      count: counts.devices_registered,
      best_next_action: counts.devices_active > 0 ? "check_connector_health" : "connect_or_repair_device",
      reason: counts.devices_active > 0 ? "active_device_present" : "no_active_device_detected",
    },
    {
      group: "connected_apps",
      ready: counts.connected_apps_active > 0,
      count: counts.connected_apps,
      best_next_action: counts.connected_apps_active > 0 ? "review_connected_app_readiness" : "connect_high_value_app",
      reason: counts.connected_apps_active > 0 ? "active_connected_systems_present" : "no_active_connected_systems_detected",
    },
    {
      group: "safe_read_only_actions",
      ready: counts.read_only_actions > 0,
      count: counts.read_only_actions,
      best_next_action: "offer_read_only_status_or_inventory_workflow",
      reason: "read_only_surfaces_can_be_offered_without_mutation",
    },
    {
      group: "approval_required_actions",
      ready: counts.approval_required_actions > 0,
      count: counts.approval_required_actions,
      best_next_action: "explain_approval_required_paths_without_executing",
      reason: "mutating_or_high_risk_surfaces_must_be_presented_as_approval_gated",
    },
  ];
  if (profile === "admin") {
    groups.push(
      {
        group: "workspace_management",
        ready: counts.workspaces_or_tenants > 0 || counts.active_memberships > 0,
        count: counts.workspaces_or_tenants,
        best_next_action: "review_workspace_and_member_operational_state",
        reason: "admin_profile_manages_workspace_tenant_and_membership_state",
      },
      {
        group: "brand_management",
        ready: counts.brands_active > 0,
        count: counts.brands_total,
        best_next_action: counts.brands_active > 0 ? "review_brand_readiness_and_next_actions" : "onboard_or_activate_brand_core",
        reason: "admin_profile_manages_brand_core_readiness_and_growth_operations",
      }
    );
  }
  return groups;
}

function rankNextActions({ profile, counts, groups }) {
  const actions = [];
  const add = (rank, action_key, label, reason, risk = "low", requires_confirmation = false) => {
    actions.push({ rank, action_key, label, reason, risk, requires_confirmation });
  };
  if (counts.devices_active > 0) add(1, "check_connector_health", "افحص صحة الجهاز والـ connector", "لأن لديك جهازًا نشطًا يمكن استخدامه كبداية آمنة", "low", false);
  if (counts.connected_apps_active > 0) add(2, "review_connected_integrations", "راجع التطبيقات المتصلة والجاهزة", "لأن لديك connected systems نشطة ويمكن تحويلها إلى workflows", "low", false);
  if (profile === "admin" && counts.brands_active > 0) add(3, "review_brand_readiness", "راجع جاهزية البراندات والمسارات التالية", "لأن الأدمن يدير براندات وحالة Brand Core تؤثر على كل مخرجات النمو", "low", false);
  if (counts.read_only_actions > 0) add(4, "offer_safe_read_only_workflows", "اعرض workflows آمنة للقراءة فقط", "لأن read-only surfaces متاحة ويمكن البدء بها بدون مخاطرة", "low", false);
  if (counts.approval_required_actions > 0) add(5, "explain_approval_gated_options", "اشرح المسارات التي تحتاج موافقة بدل تنفيذها", "لأن بعض الإمكانات موجودة لكنها approval-gated أو high-risk", "medium", true);
  if (!actions.length) add(1, "setup_first_connection", "ابدأ بربط أول جهاز أو integration", "لا توجد قدرة جاهزة كافية للبدء العملي", "low", false);
  return actions.sort((a, b) => a.rank - b.rank).map((item, index) => ({ ...item, rank: index + 1 }));
}

function buildInstructionPack({ profile }) {
  const scopeLabel = profile === "admin" ? "Admin GPT" : "Tenant GPT";
  return {
    policy_key: `${profile}_proactive_activation_guidance_v1`,
    applies_to: scopeLabel,
    behavior: [
      "لا تكتفِ بإعلان أن التفعيل active أو healthy.",
      "وجّه المستخدم تلقائيًا بعد كل activation أو status readback.",
      "اعرض الأعداد والصلاحيات والجاهزية والقيود بشكل مختصر ومفهوم.",
      "فرّق بين connected وconfigured وauthenticated وauthorized وskill_granted وsmoke_certified وruntime_ready وcan_execute.",
      "لا تعرض raw bindings كقدرات نهائية؛ اعرض tenant/admin resolved readiness فقط.",
      "اقترح أفضل خطوة تالية واحدة بناءً على readiness والقيمة والمخاطر.",
      "لا تقترح live mutation كخطوة مباشرة إذا كانت approval-gated أو preview-only.",
    ],
    required_sections: [
      "activation_brief",
      "account_or_admin_capability_snapshot",
      "capability_groups",
      "recommended_next_actions",
      "safe_action_menu",
      "blocked_or_limited_capabilities",
    ],
    admin_extension: profile === "admin"
      ? ["أضف منظور workspace management.", "أضف منظور brand management.", "أضف platform/tooling guidance بدون كشف أسرار."]
      : [],
  };
}

function buildBrief({ profile, tenantContext, counts, recommendedNextActions }) {
  const subject = profile === "admin" ? "إدارة المنصة والـ workspaces والبراندات" : "حسابك والـ workspace الخاص بك";
  return {
    title: profile === "admin" ? "Admin Activation Guidance Brief" : "Tenant Activation Guidance Brief",
    status: "ready_to_guide_user",
    summary_ar: `تم تجهيز ${subject}. لا تنتظر سؤال المستخدم؛ ابدأ بتوجيهه بناءً على الأعداد والصلاحيات والجاهزية الحالية.`,
    workspace_or_tenant: tenantContext ? {
      tenant_id: tenantContext.tenant_id,
      display_name: tenantContext.display_name,
      tenant_type: tenantContext.tenant_type,
      role: tenantContext.role || (profile === "admin" ? "admin" : null),
      status: tenantContext.status || tenantContext.tenant_status || "active",
    } : null,
    best_next_action: recommendedNextActions[0] || null,
    why_this_action: recommendedNextActions[0]?.reason || null,
    user_prompt_to_offer_ar: recommendedNextActions[0]
      ? `أفضل بداية الآن: ${recommendedNextActions[0].label} — ${recommendedNextActions[0].reason}.`
      : "أفضل بداية الآن: اقرأ حالة الحساب ثم اعرض أول إجراء آمن متاح.",
  };
}

export async function buildActivationGuidance({
  profile = "tenant",
  userId = null,
  tenantId = null,
  requestedLocale = null,
  acceptLanguage = null,
} = {}) {
  const normalizedProfile = profile === "admin" ? "admin" : "tenant";
  const tenantContext = normalizedProfile === "admin"
    ? await fetchAdminTenantContext({ tenantId })
    : await fetchTenantContext({ userId, tenantId });
  const effectiveTenantId = tenantContext?.tenant_id || tenantId || null;
  const counts = await buildCounts({ profile: normalizedProfile, userId, tenantId: effectiveTenantId });
  const groups = buildCapabilityGroups({ profile: normalizedProfile, counts });
  const recommendedNextActions = rankNextActions({ profile: normalizedProfile, counts, groups });
  const toolRows = await readToolRows(normalizedProfile === "admin" ? "admin_platform_endpoint_tools" : "tenant_platform_endpoint_tools", "is_enabled = 1", []);
  const classified = classifyTools(toolRows);
  const languageContext = await resolveGuidanceLanguagePreference({
    userId,
    tenantId: effectiveTenantId,
    requestedLocale,
    acceptLanguage,
  });
  const activationBrief = buildBrief({ profile: normalizedProfile, tenantContext, counts, recommendedNextActions });
  const permissionSemantics = {
    connected_is_not_authorized: true,
    raw_binding_is_not_allowed_capability: true,
    requires_resolved_readiness: true,
    live_mutation_requires_approval: true,
  };
  const readinessDimensions = [
    "connected",
    "configured",
    "authenticated",
    "authorized",
    "skill_granted",
    "smoke_certified",
    "runtime_ready",
    "can_execute",
  ];
  const presentation = buildGuidancePresentation({
    profile: normalizedProfile,
    activationBrief,
    counts,
    permissionSemantics,
    readinessDimensions,
    capabilityGroups: groups,
    recommendedNextActions,
    safeActionMenu: classified.safeMenu,
    blockedOrLimitedCapabilities: classified.blockedOrLimited,
    languageContext,
  });
  const payload = {
    ok: true,
    activation_layer: "activation_guidance_intelligence",
    profile: normalizedProfile,
    guidance_mode: normalizedProfile === "admin" ? "workspace_brand_platform_management" : "tenant_user_workspace_guidance",
    activation_brief: buildBrief({ profile: normalizedProfile, tenantContext, counts, recommendedNextActions }),
    account_or_admin_capability_snapshot: {
      counts,
      permission_semantics: {
        connected_is_not_authorized: true,
        raw_binding_is_not_allowed_capability: true,
        requires_resolved_readiness: true,
        live_mutation_requires_approval: true,
      },
      readiness_dimensions: [
        "connected",
        "configured",
        "authenticated",
        "authorized",
        "skill_granted",
        "smoke_certified",
        "runtime_ready",
        "can_execute",
      ],
    },
    capability_groups: groups,
    recommended_next_actions: recommendedNextActions,
    safe_action_menu: classified.safeMenu,
    blocked_or_limited_capabilities: classified.blockedOrLimited,
    assistant_instruction_pack: buildInstructionPack({ profile: normalizedProfile }),
    generated_at: new Date().toISOString(),
    secrets_included: false,
  };
  return stripSensitive(payload);
}
