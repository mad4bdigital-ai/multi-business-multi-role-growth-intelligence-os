const MODE_ALIASES = new Map([
  ["managed", "platform_managed"], ["platform", "platform_managed"], ["platform_managed", "platform_managed"],
  ["dedicated", "dedicated_managed"], ["dedicated_managed", "dedicated_managed"], ["self_hosted", "dedicated_managed"], ["local", "dedicated_managed"],
]);
const SURFACE_ALIASES = new Map([
  ["hermes", "hermes"], ["hermes_surface", "hermes"],
  ["openclaude", "openclaude"], ["open_claude", "openclaude"], ["opencloude", "openclaude"],
  ["openclaw", "openclaw"], ["open_claw", "openclaw"],
]);
export const AGENT_SURFACE_MODES = Object.freeze(["platform_managed", "dedicated_managed"]);
const HIGH_RISK = Object.freeze(["shell", "file_write", "repo_write", "external_send", "cron", "skill_activation", "multi_agent_delegation", "browser_control"]);
const SURFACES = Object.freeze({
  hermes: {
    surface_key: "hermes", display_name: "Hermes Agent Surface", role: "desktop_agent_workspace",
    description: "MAD4B desktop workspace for chat, sessions, plans, memory, skills, jobs, channels, and governed tools.",
    supported_modes: AGENT_SURFACE_MODES, supported_channels: ["telegram", "whatsapp", "discord", "slack", "signal"],
    capabilities: ["chat", "sessions", "profiles", "plans", "jobs", "memory", "skills", "cron", "multi_agent", "model_selection", "voice", "files", "browser", "platform_tools", "local_tools", "channels", "shell", "file_write", "external_send"],
    high_risk_capabilities: HIGH_RISK, platform_runtime_key: "hermes_surface_platform_managed_v1",
    defaults: { enabled: true, approval_mode: "risk_based", fallback_policy: "require_approval", memory_scope: "local_profile", max_parallel_agents: 2, channels: [], capabilities: { chat: true, sessions: true, profiles: true, plans: true, jobs: true, memory: true, skills: true, cron: false, multi_agent: true, model_selection: true, voice: true, files: true, browser: false, platform_tools: true, local_tools: true, channels: true, shell: false, file_write: false, external_send: false } },
  },
  openclaude: {
    surface_key: "openclaude", display_name: "OpenClaude Coding Agent", role: "coding_agent",
    description: "Coding and repository agent using governed providers, tests, MCP, and sub-agents.",
    supported_modes: AGENT_SURFACE_MODES, supported_channels: [],
    capabilities: ["repo_read", "repo_write", "code_analysis", "code_edit", "tests", "git", "shell", "browser", "mcp", "sub_agents", "model_selection", "platform_tools"],
    high_risk_capabilities: HIGH_RISK, platform_runtime_key: "platform_openrouter_dev_agent_v1",
    defaults: { enabled: true, approval_mode: "risk_based", fallback_policy: "require_approval", memory_scope: "disabled", max_parallel_agents: 2, channels: [], capabilities: { repo_read: true, repo_write: false, code_analysis: true, code_edit: false, tests: true, git: false, shell: false, browser: false, mcp: true, sub_agents: true, model_selection: true, platform_tools: true } },
  },
  openclaw: {
    surface_key: "openclaw", display_name: "OpenClaw Channel Gateway", role: "channel_gateway",
    description: "Multi-channel gateway and tenant agent router for messaging, webhooks, skills, and automations.",
    supported_modes: AGENT_SURFACE_MODES, supported_channels: ["telegram", "whatsapp", "discord", "slack", "signal", "matrix", "line", "wechat"],
    capabilities: ["channels", "multi_agent", "routing", "webhooks", "cron", "skills", "memory", "browser", "voice", "files", "platform_tools", "external_send", "shell", "file_write"],
    high_risk_capabilities: HIGH_RISK, platform_runtime_key: "openclaw_platform_managed_v1",
    defaults: { enabled: true, approval_mode: "risk_based", fallback_policy: "require_approval", memory_scope: "tenant_private", max_parallel_agents: 4, channels: [], capabilities: { channels: true, multi_agent: true, routing: true, webhooks: true, cron: false, skills: true, memory: true, browser: false, voice: true, files: true, platform_tools: true, external_send: false, shell: false, file_write: false } },
  },
});
const PREFERENCE_FIELDS = new Set(["enabled", "approval_mode", "fallback_policy", "memory_scope", "max_parallel_agents", "default_model", "channels", "capabilities", "channel_preferences", "notification_preferences", "ui_preferences"]);
const SECRET_LIKE = /(password|passwd|secret|token|credential|private[_-]?key|api[_-]?key|client[_-]?secret|authorization|cookie)/i;
function fail(code, message, details) { const error = new Error(message); error.status = 400; error.code = code; if (details !== undefined) error.details = details; return error; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function assertNoSecrets(value, path = "preferences") { if (!value || typeof value !== "object") return; for (const [key, child] of Object.entries(value)) { if (SECRET_LIKE.test(key)) throw fail("agent_surface_sensitive_preference_rejected", `Sensitive field is not allowed at ${path}.${key}.`); assertNoSecrets(child, `${path}.${key}`); } }
function stringArray(value, allowed = null) { const list = [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))].slice(0, 32); const unknown = allowed ? list.filter((item) => !allowed.includes(item)) : []; if (unknown.length) throw fail("agent_surface_preference_value_invalid", "Unsupported values were provided.", { unknown }); return list; }
export function normalizeAgentSurfaceKey(value) { const key = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_"); const canonical = SURFACE_ALIASES.get(key); if (!canonical) throw fail("agent_surface_unknown", "surface_key must be hermes, openclaude, or openclaw."); return canonical; }
export function normalizeAgentSurfaceMode(value, fallback = "platform_managed") { const key = String(value || fallback).trim().toLowerCase().replace(/[\s-]+/g, "_"); const canonical = MODE_ALIASES.get(key); if (!canonical) throw fail("agent_surface_mode_invalid", "activation_mode must be platform_managed or dedicated_managed."); return canonical; }
export function getAgentSurfaceDefinition(value) { return clone(SURFACES[normalizeAgentSurfaceKey(value)]); }
export function agentSurfaceCatalog() { return { version: "multi_surface_agent_runtime_v1", modes: [...AGENT_SURFACE_MODES], surfaces: Object.values(SURFACES).map(clone), governance: { full_capability_catalog_visible: true, preferences_owned_by_authenticated_user: true, high_risk_preferences_require_execution_approval: true, tenant_deployment_requires_owner_or_admin: true, platform_secrets_remain_server_side: true, automatic_cross_mode_fallback: false, secrets_included: false } }; }
export function normalizeAgentSurfacePreferences(surfaceValue, raw = {}) {
  const surface = getAgentSurfaceDefinition(surfaceValue); if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw fail("agent_surface_preferences_invalid", "preferences must be an object."); assertNoSecrets(raw);
  const unknown = Object.keys(raw).filter((key) => !PREFERENCE_FIELDS.has(key)); if (unknown.length) throw fail("agent_surface_preference_field_unknown", "Unsupported preference fields were provided.", { unknown });
  const value = clone(surface.defaults);
  if (raw.enabled !== undefined) value.enabled = raw.enabled === true;
  if (raw.approval_mode !== undefined) { if (!["always", "risk_based", "manual"].includes(raw.approval_mode)) throw fail("agent_surface_approval_mode_invalid", "approval_mode is invalid."); value.approval_mode = raw.approval_mode; }
  if (raw.fallback_policy !== undefined) { if (!["none", "require_approval", "platform_only", "dedicated_only"].includes(raw.fallback_policy)) throw fail("agent_surface_fallback_policy_invalid", "fallback_policy is invalid."); value.fallback_policy = raw.fallback_policy; }
  if (raw.memory_scope !== undefined) { if (!["disabled", "local_profile", "tenant_private"].includes(raw.memory_scope)) throw fail("agent_surface_memory_scope_invalid", "memory_scope is invalid."); value.memory_scope = raw.memory_scope; }
  if (raw.max_parallel_agents !== undefined) { const count = Number.parseInt(raw.max_parallel_agents, 10); if (!Number.isFinite(count) || count < 1 || count > 12) throw fail("agent_surface_parallelism_invalid", "max_parallel_agents must be between 1 and 12."); value.max_parallel_agents = count; }
  if (raw.default_model !== undefined) { const model = String(raw.default_model || "").trim(); if (model.length > 191) throw fail("agent_surface_default_model_invalid", "default_model is too long."); value.default_model = model || null; }
  if (raw.channels !== undefined) value.channels = stringArray(raw.channels, surface.supported_channels);
  if (raw.capabilities !== undefined) { if (!raw.capabilities || typeof raw.capabilities !== "object" || Array.isArray(raw.capabilities)) throw fail("agent_surface_capabilities_invalid", "capabilities must be an object."); const bad = Object.keys(raw.capabilities).filter((key) => !surface.capabilities.includes(key)); if (bad.length) throw fail("agent_surface_capability_unknown", "Unknown capability preference.", { unknown: bad }); value.capabilities = { ...value.capabilities }; for (const [key, enabled] of Object.entries(raw.capabilities)) value.capabilities[key] = enabled === true; }
  for (const field of ["channel_preferences", "notification_preferences", "ui_preferences"]) if (raw[field] !== undefined) { if (!raw[field] || typeof raw[field] !== "object" || Array.isArray(raw[field])) throw fail("agent_surface_nested_preference_invalid", `${field} must be an object.`); value[field] = clone(raw[field]); }
  return value;
}
