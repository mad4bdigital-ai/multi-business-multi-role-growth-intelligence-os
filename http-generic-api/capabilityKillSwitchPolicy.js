const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled", "block", "blocked"]);

const MUTATING_ACTIONS = Object.freeze({
  local_shell: new Set(["run", "shell_fetch_upload"]),
  local_file_mutation: new Set(["write", "delete", "remove", "unlink", "move", "rename", "mkdir", "rmdir"]),
  cloudflare_mutation: new Set(["create_dns", "delete_dns", "purge_cache"]),
  n8n_mutation: new Set(["start", "stop", "restart", "activate_workflow", "deactivate_workflow", "run_workflow"]),
  raw_credential_intake_creation: new Set(["create"]),
});

export const CAPABILITY_KILL_SWITCHES = Object.freeze({
  local_shell: Object.freeze({
    env_var: "CAPABILITY_KILL_SWITCH_LOCAL_SHELL",
    description: "Blocks local shell execution while preserving status and alias listing.",
  }),
  local_file_mutation: Object.freeze({
    env_var: "CAPABILITY_KILL_SWITCH_LOCAL_FILE_MUTATION",
    description: "Blocks local file writes and deletes while preserving read and discovery operations.",
  }),
  cloudflare_mutation: Object.freeze({
    env_var: "CAPABILITY_KILL_SWITCH_CLOUDFLARE_MUTATION",
    description: "Blocks Cloudflare DNS and cache mutations while preserving read operations.",
  }),
  n8n_mutation: Object.freeze({
    env_var: "CAPABILITY_KILL_SWITCH_N8N_MUTATION",
    description: "Blocks n8n lifecycle and workflow mutations while preserving status and list operations.",
  }),
  raw_credential_intake_creation: Object.freeze({
    env_var: "CAPABILITY_KILL_SWITCH_RAW_CREDENTIAL_INTAKE",
    description: "Blocks raw admin credential-intake session creation without disabling tenant-safe intake flows.",
  }),
});

export function parseCapabilityKillSwitchValue(value) {
  return ENABLED_VALUES.has(String(value ?? "").trim().toLowerCase());
}

export function isCapabilityMutationAction(surface, action) {
  const normalizedSurface = String(surface || "").trim().toLowerCase();
  const normalizedAction = String(action || "").trim().toLowerCase();
  return MUTATING_ACTIONS[normalizedSurface]?.has(normalizedAction) || false;
}

export function evaluateCapabilityKillSwitch({ surface, action, env = process.env } = {}) {
  const normalizedSurface = String(surface || "").trim().toLowerCase();
  const normalizedAction = String(action || "").trim().toLowerCase();
  const definition = CAPABILITY_KILL_SWITCHES[normalizedSurface] || null;
  const mutation = isCapabilityMutationAction(normalizedSurface, normalizedAction);
  const enabled = definition ? parseCapabilityKillSwitchValue(env?.[definition.env_var]) : false;
  return {
    blocked: Boolean(definition && mutation && enabled),
    surface: normalizedSurface || null,
    action: normalizedAction || null,
    mutation,
    switch_enabled: enabled,
    switch_key: definition ? normalizedSurface : null,
    env_var: definition?.env_var || null,
    secrets_included: false,
  };
}

export function capabilityKillSwitchError(decision = {}) {
  const error = new Error(`Capability '${decision.surface || "unknown"}' is temporarily disabled by an operational kill switch.`);
  error.status = 503;
  error.code = "CAPABILITY_KILL_SWITCH_ENABLED";
  error.details = {
    switch_key: decision.switch_key || null,
    surface: decision.surface || null,
    action: decision.action || null,
    env_var: decision.env_var || null,
    retryable: true,
    secrets_included: false,
  };
  return error;
}

export function assertCapabilityKillSwitchOpen(input = {}) {
  const decision = evaluateCapabilityKillSwitch(input);
  if (decision.blocked) throw capabilityKillSwitchError(decision);
  return decision;
}

export function capabilityKillSwitchSnapshot(env = process.env) {
  return Object.fromEntries(Object.entries(CAPABILITY_KILL_SWITCHES).map(([surface, definition]) => [surface, {
    enabled: parseCapabilityKillSwitchValue(env?.[definition.env_var]),
    env_var: definition.env_var,
    description: definition.description,
    secrets_included: false,
  }]));
}