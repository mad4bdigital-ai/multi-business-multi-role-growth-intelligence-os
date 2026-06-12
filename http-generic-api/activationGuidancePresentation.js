import { getPool } from "./db.js";

const LANGUAGE_KEYS = Object.freeze(["locale", "language", "preferred_locale", "preferred_language", "ui_locale", "ui_language"]);

const MESSAGE_CATALOG = Object.freeze({
  "flow.activation.title": { ar: "حالة التفعيل", en: "Activation status" },
  "flow.activation.summary": { ar: "ابدأ بتأكيد الجاهزية العامة، ثم انتقل إلى نطاق الحساب والصلاحيات.", en: "Confirm overall readiness first, then move to account scope and permissions." },
  "flow.scope.title": { ar: "نطاق الحساب والإدارة", en: "Account and management scope" },
  "flow.scope.summary": { ar: "اعرض الـ workspace أو tenant والدور الحالي قبل عرض الإمكانات.", en: "Show the current workspace or tenant and role before presenting capabilities." },
  "flow.admin_management.title": { ar: "إدارة الـ workspaces والبراندات", en: "Workspace and brand management" },
  "flow.admin_management.summary": { ar: "للأدمن، افصل مسارات إدارة الـ workspace والعضويات والبراندات عن أدوات المنصة العامة.", en: "For admins, separate workspace, membership, and brand management paths from general platform tooling." },
  "flow.counts.title": { ar: "صورة الحساب بالأعداد", en: "Account snapshot" },
  "flow.counts.summary": { ar: "اعرض الأعداد الفعلية للأجهزة والتطبيقات والأدوات والبراندات وفق النطاق الحالي.", en: "Show actual counts for devices, apps, tools, and brands within the current scope." },
  "flow.permissions.title": { ar: "الصلاحيات والجاهزية", en: "Permissions and readiness" },
  "flow.permissions.summary": { ar: "فرّق بين الاتصال والتوثيق والتفويض والجاهزية الفعلية للتنفيذ.", en: "Separate connection, authentication, authorization, and actual execution readiness." },
  "flow.ready.title": { ar: "المسارات الجاهزة الآن", en: "Ready paths" },
  "flow.ready.summary": { ar: "اعرض المسارات الآمنة والقابلة للبدء فورًا، مع سبب جاهزية كل مسار.", en: "Present safe paths that can start now and explain why each path is ready." },
  "flow.limited.title": { ar: "المسارات المحدودة أو التي تحتاج موافقة", en: "Limited or approval-gated paths" },
  "flow.limited.summary": { ar: "اعرض القيود بوضوح دون تقديم المسار كأنه قابل للتنفيذ المباشر.", en: "Show limitations clearly without presenting the path as directly executable." },
  "flow.next.title": { ar: "أفضل خطوة تالية", en: "Best next action" },
  "flow.next.summary": { ar: "اختر خطوة واحدة فقط بناءً على الجاهزية والقيمة وانخفاض المخاطر.", en: "Choose one action based on readiness, value, and low risk." },
  "flow.commands.title": { ar: "إشارات الاستدعاء", en: "Invocation signals" },
  "flow.commands.summary": { ar: "استخدم الـ tags أو slash commands للانتقال المباشر إلى أي مسار دون فقدان السياق.", en: "Use tags or slash commands to jump directly to a path without losing context." },
  "brief.tenant.title": { ar: "ملخص تفعيل الحساب", en: "Account activation brief" },
  "brief.admin.title": { ar: "ملخص تفعيل الإدارة", en: "Admin activation brief" },
  "brief.tenant.summary": { ar: "تم تجهيز حسابك والـ workspace. ابدأ بالتوجيه وفق الجاهزية والصلاحيات الفعلية.", en: "Your account and workspace are ready for guided next steps based on actual readiness and permissions." },
  "brief.admin.summary": { ar: "تم تجهيز إدارة الـ workspaces والبراندات والمنصة. ابدأ بالتوجيه وفق الجاهزية والصلاحيات الفعلية.", en: "Workspace, brand, and platform management are ready for guided next steps based on actual readiness and permissions." },
  "action.check_connector_health.label": { ar: "افحص صحة الجهاز والـ connector", en: "Check device and connector health" },
  "action.check_connector_health.reason": { ar: "لأن لديك جهازًا نشطًا يمكن استخدامه كبداية آمنة", en: "Because an active device is available as a safe starting point" },
  "action.review_connected_integrations.label": { ar: "راجع التطبيقات المتصلة والجاهزة", en: "Review connected and ready integrations" },
  "action.review_connected_integrations.reason": { ar: "لأن لديك أنظمة متصلة نشطة يمكن تحويلها إلى workflows", en: "Because active connected systems can be turned into workflows" },
  "action.review_brand_readiness.label": { ar: "راجع جاهزية البراندات والمسارات التالية", en: "Review brand readiness and next paths" },
  "action.review_brand_readiness.reason": { ar: "لأن جاهزية Brand Core تؤثر على مخرجات النمو", en: "Because Brand Core readiness affects growth outputs" },
  "action.offer_safe_read_only_workflows.label": { ar: "اعرض workflows آمنة للقراءة فقط", en: "Offer safe read-only workflows" },
  "action.offer_safe_read_only_workflows.reason": { ar: "لأن مسارات القراءة متاحة ويمكن البدء بها بدون تغيير الحالة", en: "Because read-only surfaces are available without changing state" },
  "action.explain_approval_gated_options.label": { ar: "اشرح المسارات التي تحتاج موافقة", en: "Explain approval-gated paths" },
  "action.explain_approval_gated_options.reason": { ar: "لأن بعض الإمكانات موجودة لكنها تحتاج موافقة أو جاهزية إضافية", en: "Because some capabilities exist but require approval or additional readiness" },
  "action.setup_first_connection.label": { ar: "ابدأ بربط أول جهاز أو integration", en: "Set up the first device or integration" },
  "action.setup_first_connection.reason": { ar: "لأنه لا توجد قدرة جاهزة كافية للبدء العملي", en: "Because there is not yet enough ready capability to start practical work" },
  "action.read_activation_guidance_brief.label": { ar: "اعرض ملخص التفعيل", en: "Show the activation brief" },
  "action.read_activation_guidance_brief.reason": { ar: "لأن طبقة الإرشاد جاهزة لعرض الأعداد والصلاحيات والخطوة التالية", en: "Because the guidance layer can present counts, permissions, and the next action" },
  "action.review_workspace_and_member_operational_state.label": { ar: "راجع حالة الـ workspace والعضويات", en: "Review workspace and membership status" },
  "action.review_workspace_and_member_operational_state.reason": { ar: "لأن الأدمن يدير نطاق الـ workspace والعضويات", en: "Because the admin manages workspace and membership scope" },
  "action.review_brand_readiness_and_next_actions.label": { ar: "راجع جاهزية البراندات", en: "Review brand readiness" },
  "action.review_brand_readiness_and_next_actions.reason": { ar: "لأن الأدمن يدير Brand Core ومسارات النمو", en: "Because the admin manages Brand Core and growth paths" },
  "action.explain_approval_required_paths_without_executing.label": { ar: "اشرح المسارات المقيدة بالموافقة", en: "Explain approval-gated paths" },
  "action.explain_approval_required_paths_without_executing.reason": { ar: "لأن المسارات عالية المخاطر لا تُعرض كتنفيذ مباشر", en: "Because high-risk paths must not be presented as directly executable" },
  "action.offer_read_only_status_or_inventory_workflow.label": { ar: "اعرض workflow آمن للقراءة", en: "Offer a safe read-only workflow" },
  "action.offer_read_only_status_or_inventory_workflow.reason": { ar: "لأن مسارات الحالة والجرد متاحة بدون mutation", en: "Because status and inventory surfaces are available without mutation" },
});

const ACTION_INVOCATIONS = Object.freeze({
  read_activation_guidance_brief: { tag: "@activation/brief", slash: "/activation", intent: "activation.guidance.brief", entities: ["activation"], mode: "read_only", tool_candidates: ["tenant_activation_guidance_read_api", "admin_activation_guidance_read_api"] },
  check_connector_health: { tag: "@connector/health", slash: "/connector-health", intent: "connector.health.read", entities: ["device", "connector"], mode: "read_only", tool_candidates: ["health_check", "local_gateway_tools_list"] },
  connect_or_repair_device: { tag: "@device/connect", slash: "/device-connect", intent: "device.connection.prepare", entities: ["device", "connector"], mode: "setup_or_repair", tool_candidates: [] },
  review_connected_app_readiness: { tag: "@integration/readiness", slash: "/integrations", intent: "integration.readiness.review", entities: ["connected_system", "integration"], mode: "read_only", tool_candidates: ["operational_console_read_api"] },
  connect_high_value_app: { tag: "@integration/connect", slash: "/connect-app", intent: "integration.connection.plan", entities: ["integration"], mode: "setup", tool_candidates: [] },
  offer_read_only_status_or_inventory_workflow: { tag: "@workflow/read-only", slash: "/safe-workflows", intent: "workflow.read_only.offer", entities: ["workflow", "tool"], mode: "read_only", tool_candidates: [] },
  explain_approval_required_paths_without_executing: { tag: "@approval/explain", slash: "/approvals", intent: "approval.paths.explain", entities: ["capability", "approval"], mode: "advisory", tool_candidates: [] },
  review_workspace_and_member_operational_state: { tag: "@workspace/overview", slash: "/workspace", intent: "workspace.operational.review", entities: ["workspace", "tenant", "membership"], mode: "read_only", tool_candidates: ["admin_activation_guidance_read_api"] },
  review_brand_readiness_and_next_actions: { tag: "@brand/readiness", slash: "/brands", intent: "brand.readiness.review", entities: ["brand", "brand_core"], mode: "read_only", tool_candidates: ["admin_activation_guidance_read_api"] },
  onboard_or_activate_brand_core: { tag: "@brand/onboard", slash: "/brand-onboard", intent: "brand.core.onboard.plan", entities: ["brand", "brand_core"], mode: "setup", tool_candidates: [] },
  review_connected_integrations: { tag: "@integration/review", slash: "/integrations", intent: "integration.readiness.review", entities: ["connected_system", "integration"], mode: "read_only", tool_candidates: ["operational_console_read_api"] },
  review_brand_readiness: { tag: "@brand/readiness", slash: "/brands", intent: "brand.readiness.review", entities: ["brand", "brand_core"], mode: "read_only", tool_candidates: ["admin_activation_guidance_read_api"] },
  offer_safe_read_only_workflows: { tag: "@workflow/read-only", slash: "/safe-workflows", intent: "workflow.read_only.offer", entities: ["workflow", "tool"], mode: "read_only", tool_candidates: [] },
  explain_approval_gated_options: { tag: "@approval/options", slash: "/approvals", intent: "approval.paths.explain", entities: ["capability", "approval"], mode: "advisory", tool_candidates: [] },
  setup_first_connection: { tag: "@connection/setup", slash: "/connect", intent: "connection.first.setup", entities: ["device", "integration"], mode: "setup", tool_candidates: [] },
});

const STAGE_INVOCATIONS = Object.freeze({
  activation: { tag: "@activation/status", slash: "/activation", intent: "activation.status.read", entities: ["activation"] },
  scope: { tag: "@account/scope", slash: "/account", intent: "account.scope.read", entities: ["tenant", "workspace", "membership"] },
  admin_management: { tag: "@admin/management", slash: "/admin-scope", intent: "admin.management.review", entities: ["workspace", "brand", "platform"] },
  counts: { tag: "@account/counts", slash: "/counts", intent: "account.counts.read", entities: ["account", "capability"] },
  permissions: { tag: "@permissions/readiness", slash: "/permissions", intent: "permission.readiness.read", entities: ["permission", "capability"] },
  ready: { tag: "@capability/ready", slash: "/ready", intent: "capability.ready.list", entities: ["capability"] },
  limited: { tag: "@capability/limited", slash: "/limited", intent: "capability.limited.list", entities: ["capability", "approval"] },
  next: { tag: "@next/best-action", slash: "/next", intent: "guidance.next_best_action", entities: ["guidance"] },
  commands: { tag: "@commands/palette", slash: "/commands", intent: "guidance.command_palette", entities: ["guidance", "command"] },
});

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function firstLanguageValue(value) {
  if (!value || typeof value !== "object") return null;
  for (const key of LANGUAGE_KEYS) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  const presentation = value.presentation || value.preferences || value.localization || null;
  if (presentation && typeof presentation === "object") return firstLanguageValue(presentation);
  return null;
}

function normalizeLocale(value) {
  if (!value || typeof value !== "string") return null;
  const first = value.split(",")[0].split(";")[0].trim().replace("_", "-");
  if (!first || first.length > 35 || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/.test(first)) return null;
  return first;
}

function localeBase(locale) {
  return String(locale || "").split("-")[0].toLowerCase();
}

function localizedMessage(messageKey, languageContext) {
  const locale = languageContext.resolved_locale;
  const base = localeBase(locale);
  const catalogEntry = MESSAGE_CATALOG[messageKey] || {};
  const text = catalogEntry[base] || null;
  return {
    message_key: messageKey,
    locale,
    text,
    render_mode: text ? "server_localized" : "assistant_localized_from_message_key",
  };
}

async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return Array.isArray(rows) ? rows : [];
}

async function tableExists(tableName) {
  const rows = await query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [tableName]);
  return Number(rows[0]?.count || 0) > 0;
}

export async function resolveGuidanceLanguagePreference({ userId = null, tenantId = null, requestedLocale = null, acceptLanguage = null } = {}) {
  const explicit = normalizeLocale(requestedLocale);
  if (explicit) return { mode: "user_preference", resolved_locale: explicit, source: "request", fallback_policy: "conversation_language", machine_tags_localized: false };

  if (userId && await tableExists("actor_profiles")) {
    const rows = await query(
      `SELECT profile_data_json FROM actor_profiles
        WHERE user_id = ?
          AND status = 'active'
          AND (? IS NULL OR tenant_id = ?)
        ORDER BY id DESC LIMIT 1`,
      [userId, tenantId, tenantId]
    );
    const profileLocale = normalizeLocale(firstLanguageValue(parseJson(rows[0]?.profile_data_json, {})));
    if (profileLocale) return { mode: "user_preference", resolved_locale: profileLocale, source: "actor_profile", fallback_policy: "conversation_language", machine_tags_localized: false };
  }

  if (userId && await tableExists("activation_user_dashboard_preferences")) {
    const rows = await query(
      `SELECT layout_json FROM activation_user_dashboard_preferences
        WHERE user_id = ?
          AND status = 'active'
          AND (? IS NULL OR tenant_id = ?)
        ORDER BY updated_at DESC LIMIT 1`,
      [userId, tenantId, tenantId]
    );
    const dashboardLocale = normalizeLocale(firstLanguageValue(parseJson(rows[0]?.layout_json, {})));
    if (dashboardLocale) return { mode: "user_preference", resolved_locale: dashboardLocale, source: "dashboard_preferences", fallback_policy: "conversation_language", machine_tags_localized: false };
  }

  const headerLocale = normalizeLocale(acceptLanguage);
  if (headerLocale) return { mode: "user_preference", resolved_locale: headerLocale, source: "accept_language", fallback_policy: "conversation_language", machine_tags_localized: false };

  return { mode: "conversation_preference", resolved_locale: "conversation", source: "conversation_context", fallback_policy: "assistant_detects_user_language", machine_tags_localized: false };
}

export async function loadGuidanceInvocationRegistry({ profile = "tenant" } = {}) {
  const normalizedProfile = profile === "admin" ? "admin" : "tenant";
  if (!(await tableExists("activation_guidance_invocation_registry"))) {
    return { source: "code_fallback", row_count: 0, stages: new Map(), actions: new Map() };
  }
  const rows = await query(
    `SELECT invocation_key, profile_scope, path_type, path_key, invocation_tag, slash_alias,
            intent_key, entity_scope_json, operation_mode, default_risk,
            requires_confirmation, tool_candidates_json, priority_order
       FROM activation_guidance_invocation_registry
      WHERE status = 'active'
        AND profile_scope IN ('all', ?)
      ORDER BY priority_order ASC, invocation_key ASC`,
    [normalizedProfile]
  );
  const stages = new Map();
  const actions = new Map();
  for (const row of rows) {
    const descriptor = {
      tag: row.invocation_tag,
      slash: row.slash_alias,
      intent: row.intent_key,
      entities: parseJson(row.entity_scope_json, []),
      mode: row.operation_mode,
      default_risk: row.default_risk || "low",
      requires_confirmation: Number(row.requires_confirmation || 0) === 1,
      tool_candidates: parseJson(row.tool_candidates_json, []),
      priority_order: Number(row.priority_order || 100),
      profile_scope: row.profile_scope,
      invocation_key: row.invocation_key,
    };
    if (row.path_type === "stage") stages.set(row.path_key, descriptor);
    else actions.set(row.path_key, descriptor);
  }
  return { source: "db_registry", row_count: rows.length, stages, actions };
}

function buildInvocation(actionKey, profile, overrides = {}, invocationRegistry = null) {
  const item = invocationRegistry?.actions?.get(actionKey) || ACTION_INVOCATIONS[actionKey] || {
    tag: `@guidance/${String(actionKey || "path").replaceAll("_", "-")}`,
    slash: `/guidance-${String(actionKey || "path").replaceAll("_", "-")}`,
    intent: `guidance.${String(actionKey || "path")}`,
    entities: ["guidance"],
    mode: "advisory",
    tool_candidates: [],
  };
  const risk = overrides.risk || item.default_risk || (item.mode === "read_only" || item.mode === "advisory" ? "low" : "medium");
  const requiresConfirmation = Boolean(overrides.requires_confirmation || item.requires_confirmation || item.mode === "setup");
  return {
    invocation_tag: item.tag,
    slash_alias: item.slash,
    intent_key: item.intent,
    profile_scope: profile,
    entity_scope: item.entities,
    operation_mode: item.mode,
    risk,
    readiness: overrides.readiness || "available",
    requires_confirmation: requiresConfirmation,
    tool_candidates: item.tool_candidates,
    stable_machine_signal: true,
  };
}

function stage({ id, order, dataRef, profile, languageContext, status = "ready", nextStageId = null }) {
  const invocation = STAGE_INVOCATIONS[id];
  return {
    stage_id: id,
    order,
    status,
    title: localizedMessage(`flow.${id}.title`, languageContext),
    summary: localizedMessage(`flow.${id}.summary`, languageContext),
    data_ref: dataRef,
    invocation: {
      invocation_tag: invocation.tag,
      slash_alias: invocation.slash,
      intent_key: invocation.intent,
      profile_scope: profile,
      entity_scope: invocation.entities,
      operation_mode: "read_only_or_advisory",
      stable_machine_signal: true,
    },
    next_stage_id: nextStageId,
  };
}

export function buildGuidancePresentation({ profile, activationBrief, counts, permissionSemantics, readinessDimensions, capabilityGroups, recommendedNextActions, safeActionMenu, blockedOrLimitedCapabilities, languageContext }) {
  const stageIds = profile === "admin"
    ? ["activation", "scope", "admin_management", "counts", "permissions", "ready", "limited", "next", "commands"]
    : ["activation", "scope", "counts", "permissions", "ready", "limited", "next", "commands"];

  const dataRefs = {
    activation: "activation_brief",
    scope: "activation_brief.workspace_or_tenant",
    admin_management: "capability_groups[workspace_management,brand_management]",
    counts: "account_or_admin_capability_snapshot.counts",
    permissions: "account_or_admin_capability_snapshot.permission_semantics",
    ready: "capability_groups + safe_action_menu",
    limited: "blocked_or_limited_capabilities",
    next: "recommended_next_actions[0]",
    commands: "command_palette",
  };

  const guidanceFlow = stageIds.map((id, index) => stage({
    id,
    order: index + 1,
    dataRef: dataRefs[id],
    profile,
    languageContext,
    nextStageId: stageIds[index + 1] || null,
  }));

  const localizedRecommendedActions = recommendedNextActions.map((action) => ({
    ...action,
    label: localizedMessage(`action.${action.action_key}.label`, languageContext),
    reason: localizedMessage(`action.${action.action_key}.reason`, languageContext),
    invocation: buildInvocation(action.action_key, profile, {
      risk: action.risk,
      requires_confirmation: action.requires_confirmation,
      readiness: "recommended",
    }),
  }));

  const actionPaths = localizedRecommendedActions.map((action) => ({
    path_key: action.action_key,
    path_type: "recommended_action",
    label: action.label,
    reason: action.reason,
    invocation: action.invocation,
    source_ref: `recommended_next_actions[${Math.max(0, Number(action.rank || 1) - 1)}]`,
  }));

  const groupPaths = capabilityGroups.map((group) => ({
    path_key: group.group,
    path_type: "capability_group",
    ready: Boolean(group.ready),
    count: Number(group.count || 0),
    reason: group.reason,
    invocation: buildInvocation(group.best_next_action || group.group, profile, { readiness: group.ready ? "ready" : "not_ready" }),
    source_ref: `capability_groups.${group.group}`,
  }));

  const commandPaletteMap = new Map();
  for (const path of [...actionPaths, ...groupPaths]) {
    const key = path.invocation.invocation_tag;
    if (!commandPaletteMap.has(key)) {
      commandPaletteMap.set(key, {
        invocation_tag: path.invocation.invocation_tag,
        slash_alias: path.invocation.slash_alias,
        intent_key: path.invocation.intent_key,
        profile_scope: profile,
        operation_mode: path.invocation.operation_mode,
        risk: path.invocation.risk,
        readiness: path.invocation.readiness,
        requires_confirmation: path.invocation.requires_confirmation,
        tool_candidates: path.invocation.tool_candidates,
        source_path_keys: [path.path_key],
      });
    } else {
      commandPaletteMap.get(key).source_path_keys.push(path.path_key);
    }
  }

  const briefTitle = localizedMessage(`brief.${profile}.title`, languageContext);
  const briefSummary = localizedMessage(`brief.${profile}.summary`, languageContext);
  const bestAction = localizedRecommendedActions[0] || null;
  const baseLocale = localeBase(languageContext.resolved_locale);
  const promptText = bestAction?.label?.text && bestAction?.reason?.text
    ? baseLocale === "ar"
      ? `أفضل بداية الآن: ${bestAction.label.text} — ${bestAction.reason.text}.`
      : baseLocale === "en"
        ? `Best starting point: ${bestAction.label.text} — ${bestAction.reason.text}.`
        : null
    : null;
  const localizedActivationBrief = {
    title: briefTitle,
    status: activationBrief?.status || "ready_to_guide_user",
    summary: briefSummary,
    workspace_or_tenant: activationBrief?.workspace_or_tenant || null,
    best_next_action: bestAction,
    user_prompt_to_offer: {
      message_key: "brief.best_next_action.prompt",
      locale: languageContext.resolved_locale,
      text: promptText,
      template_data: bestAction ? {
        action_label: bestAction.label,
        action_reason: bestAction.reason,
        invocation_tag: bestAction.invocation.invocation_tag,
        slash_alias: bestAction.invocation.slash_alias,
      } : null,
      render_mode: promptText ? "server_localized" : "assistant_localized_from_template",
    },
  };

  return {
    language_context: {
      ...languageContext,
      rendering_instruction: "Render all user-facing guidance in the resolved user language or current conversation language. Keep invocation tags, slash aliases, intent keys, and tool keys unchanged.",
      tags_are_language_neutral: true,
    },
    localized_activation_brief: localizedActivationBrief,
    localized_recommended_actions: localizedRecommendedActions,
    invocation_contract: {
      version: "activation_guidance_invocation_v1",
      supported_signals: ["invocation_tag", "slash_alias", "intent_key"],
      tag_format: "@domain/path",
      slash_format: "/command",
      routing_rule: "Invocation signals select a guidance path; they do not bypass readiness, authorization, approval, or runtime validation.",
      execution_rule: "A tag is a routing hint, not proof that a tool can execute.",
    },
    guidance_flow: guidanceFlow,
    guidance_paths: [...actionPaths, ...groupPaths],
    command_palette: [...commandPaletteMap.values()],
    presentation_summary: {
      profile,
      stage_count: guidanceFlow.length,
      ready_path_count: groupPaths.filter((item) => item.ready).length,
      limited_path_count: blockedOrLimitedCapabilities.length,
      recommended_action_count: actionPaths.length,
      safe_action_count: safeActionMenu.length,
      permission_dimension_count: readinessDimensions.length,
      permission_semantics: permissionSemantics,
      counts,
      best_next_action: activationBrief?.best_next_action || null,
    },
  };
}
