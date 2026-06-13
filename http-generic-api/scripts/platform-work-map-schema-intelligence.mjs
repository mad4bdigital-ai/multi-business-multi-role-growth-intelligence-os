import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DOMAIN_RULES = [
  ["Activation & onboarding", /activation|onboarding|bootstrap|guidance|attention_rule|operational_tile|signal_inbox/i],
  ["Assets & packages", /asset|package|pack_attachment|copy_location|variant|equivalence/i],
  ["Commercial & usage", /commercial|credit|usage|billing|pricing|meter|subscription|entitlement/i],
  ["Repository & development", /repo_|git|branch|source_registry|proposal|summary_development|runtime_ci|deployment_parity|install_diff/i],
  ["Platform resources & graph", /platform_graph|platform_resource|resource_recipe|resource_type|resource_adapter|contract_surface|registry_surfaces|capabilit|decision|intent|adaptation|platform_binding|platform_export|relationship_integrity|platform_runtime_config/i],
  ["Delivery & support", /ticket|thread|timeline|email_outbox|recipient_allowlist|external_delivery|sink_dispatch|output_artifact|reporting|tracked_event/i],
  ["Migration & lifecycle", /migration|database_table_lifecycle|database_lifecycle|checkpoint|validation_repair|recovery|repair_run/i],
  ["Tenancy & identity", /tenant|membership|user|role|workspace|actor|invitation|plan|assistance/i],
  ["Brand & business", /brand|business_activity|business_type|customer|contact|campaign|audience|persona|segment|market/i],
  ["Agents & intelligence", /agent|skill|plugin|logic|engine|model|prompt|knowledge|intelligence/i],
  ["Workflow & tasks", /workflow|task|route|step|approval|job|orchestrat|execution_plan|execution_enablement|(^|_)actions?$|app_action|resume_action/i],
  ["Connectors & providers", /connector|connected_system|installation|credential|provider|app_integration|user_app_connection|webhook|oauth|cloudflare|hostinger|wordpress|n8n|local_gateway|device|browser_runtime|remote_runtime|local_project_path|cms_|site_inspection/i],
  ["Governance & authority", /policy|permission|grant|authority|quota|budget|compliance|access|rate_limit|auth_|secret_reference|platform_secrets|preflight/i],
  ["Sessions & memory", /session|conversation|turn|memory|scope_link|archive|insight|graph_memory|request_envelope/i],
  ["Observability & release", /execution_log|audit|telemetry|incident|readiness|monitor|release|backup|restore|snapshot|health|certification|diagnostic|evidence|dr_|runtime_gap|runtime_verification|runtime_production_parity|runtime_context_dimension|summary_comparison/i],
  ["Developer & API", /developer|api_|endpoint|tool|schema|upload|openapi/i],
];

const MAP_SPECS = [
  ["agent-skill-plugin-map.md", "Agent, Skill, Plugin, and Intelligence Map", /agent|skill|plugin|logic|engine|model|prompt|knowledge/i, ["Intent", "Agent resolution", "Skill grants", "Logic / engine", "Model policy", "Tool / plugin binding", "Execution evidence"]],
  ["workflow-task-orchestration-map.md", "Workflow, Task, and Orchestration Map", /workflow|task|route|step|approval|job|orchestrat|execution_plan|execution_enablement|(^|_)actions?$|app_action|resume_action|snapshot/i, ["Intent / event", "Task route", "Execution plan", "Workflow binding", "Step runs", "Approval / hold", "Snapshot / readback"]],
  ["policy-authority-map.md", "Policy, Permission, and Authority Map", /policy|permission|grant|authority|quota|budget|entitlement|compliance|access|role_assignment|credential_binding|rate_limit/i, ["Actor context", "Role / entitlement", "Permission grant", "Resource authority", "Budget / quota", "Runtime policy", "Allow / block evidence"]],
  ["connector-provider-map.md", "Connector, Provider, and Connected App Map", /connector|connected_system|installation|credential|provider|app_integration|user_app_connection|webhook|oauth|cloudflare|hostinger|wordpress|n8n|local_gateway|device/i, ["App / provider", "Connected system", "Installation", "Credential binding", "Permission grant", "Connector route", "Provider result", "Execution evidence"]],
  ["observability-release-map.md", "Observability, Audit, and Release Map", /execution_log|audit|telemetry|incident|readiness|monitor|release|backup|restore|snapshot|health|certification|diagnostic|evidence|dr_|runtime_gap|runtime_verification|runtime_production_parity|runtime_context_dimension|summary_comparison/i, ["Runtime event", "Execution evidence", "Audit / telemetry", "Readiness views", "Incident / repair", "Release gate", "DR certification"]],
  ["activation-onboarding-map.md", "Activation, Bootstrap, and Onboarding Map", /activation|onboarding|bootstrap|guidance|attention_rule|operational_tile|signal_inbox/i, ["Session start", "Bootstrap authority", "Authorization envelope", "Surface discovery", "Onboarding state", "Attention / guidance", "Activation evidence"]],
  ["asset-package-map.md", "Asset, Package, and Variant Map", /asset|package|pack_attachment|copy_location|variant|equivalence/i, ["Source asset", "Ownership link", "Package version", "Variant", "Patch / merge", "Private distribution", "Runtime consumption"]],
  ["commercial-usage-map.md", "Commercial, Credit, Entitlement, and Usage Map", /commercial|credit|usage|billing|pricing|meter|subscription|entitlement/i, ["Commercial profile", "Plan / entitlement", "Credit balance", "Usage meter", "Limit / quota", "Eligibility decision", "Execution evidence"]],
  ["repository-development-map.md", "Repository, Development, and Deployment Map", /repo_|git|branch|source_registry|proposal|summary_development|runtime_ci|deployment_parity|install_diff/i, ["Repository source", "Candidate / proposal", "Install diff", "Patch branch", "CI classification", "Merge gate", "Deployment parity", "Readback"]],
  ["platform-resource-graph-map.md", "Platform Resource, Capability, and Graph Map", /platform_graph|platform_resource|resource_recipe|resource_type|resource_adapter|contract_surface|registry_surfaces|capability|decision|intent|adaptation|platform_binding|platform_export|relationship_integrity|platform_runtime_config/i, ["Intent / decision", "Capability source", "Contract surface", "Resource type", "Adapter / recipe", "Graph projection", "Validation evidence"]],
  ["delivery-support-map.md", "Output Delivery, Support, and Communication Map", /ticket|thread|timeline|email_outbox|recipient_allowlist|external_delivery|sink_dispatch|output_artifact|reporting|tracked_event/i, ["Output artifact", "Recipient allowlist", "Sink routing", "Delivery event", "Ticket / thread", "Timeline / tracking", "Readback"]],
  ["migration-lifecycle-map.md", "Migration, Data Lifecycle, and Recovery Map", /migration|database_table_lifecycle|database_lifecycle|checkpoint|validation_repair|recovery|repair_run/i, ["Migration candidate", "Preflight", "Authorization", "Apply / record", "Lifecycle registry", "Checkpoint", "Repair / recovery", "Readiness"]],
].map(([file, title, pattern, flow]) => ({ file, title, pattern, flow }));

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function listFiles(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, predicate) : predicate(full) ? [full] : [];
  }).sort();
}

function rel(root, file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function hashFiles(root, files) {
  const hash = crypto.createHash("sha256");
  for (const file of uniq(files)) {
    hash.update(rel(root, file));
    hash.update("\0");
    hash.update(readText(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function classify(name) {
  return DOMAIN_RULES.find(([, pattern]) => pattern.test(name))?.[0] || "Other / uncategorized";
}

function mermaidId(value) {
  return `n_${String(value).replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function esc(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function tableBlocks(text) {
  const blocks = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?\s*\(/gi;
  let match;
  while ((match = re.exec(text))) {
    let depth = 1;
    let quote = null;
    let escaped = false;
    let index = re.lastIndex;
    for (; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) { escaped = false; continue; }
      if (quote && char === "\\") { escaped = true; continue; }
      if (quote) { if (char === quote) quote = null; continue; }
      if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (depth === 0) break;
    }
    blocks.push({ name: match[1], body: text.slice(re.lastIndex, index) });
    re.lastIndex = Math.max(index + 1, re.lastIndex);
  }
  return blocks;
}

function parseCatalog(repoRoot) {
  const files = listFiles(path.join(repoRoot, "http-generic-api/migrations"), (file) => file.endsWith(".sql"));
  const tables = new Map();
  const views = new Map();
  const policies = new Map();
  const ensure = (map, name, type) => {
    if (!map.has(name)) map.set(name, { name, type, domain: classify(name), sources: new Set(), columns: new Set(), refs: new Set() });
    return map.get(name);
  };

  for (const file of files) {
    const text = readText(file);
    for (const block of tableBlocks(text)) {
      const table = ensure(tables, block.name, "table");
      table.sources.add(file);
      for (const column of block.body.matchAll(/^\s*`([^`]+)`\s+/gm)) table.columns.add(column[1]);
      for (const ref of block.body.matchAll(/REFERENCES\s+`?([A-Za-z0-9_]+)`?/gi)) table.refs.add(ref[1]);
    }
    for (const match of text.matchAll(/ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?/gi)) ensure(tables, match[1], "table").sources.add(file);
    for (const match of text.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+`?([A-Za-z0-9_]+)`?/gi)) ensure(views, match[1], "view").sources.add(file);
    for (const match of text.matchAll(/['"]([A-Za-z0-9_.:-]+_policy_v\d+)['"]/gi)) {
      if (!policies.has(match[1])) policies.set(match[1], new Set());
      policies.get(match[1]).add(file);
    }
  }

  const aliases = new Map();
  for (const name of tables.keys()) {
    aliases.set(name, name);
    aliases.set(name.endsWith("s") ? name.slice(0, -1) : name, name);
  }
  for (const table of tables.values()) {
    for (const column of table.columns) {
      if (!column.endsWith("_id")) continue;
      const target = aliases.get(column.slice(0, -3));
      if (target && target !== table.name) table.refs.add(target);
    }
  }

  return {
    files,
    tables: [...tables.values()].sort((a, b) => a.name.localeCompare(b.name)),
    views: [...views.values()].sort((a, b) => a.name.localeCompare(b.name)),
    policies: [...policies.entries()].map(([key, sources]) => ({ key, sources })).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

function parseMemory(repoRoot) {
  const file = path.join(repoRoot, "memory_schema.json");
  try {
    const schema = JSON.parse(readText(file));
    const required = new Set(schema.required || []);
    const states = Object.entries(schema.properties || {}).map(([key, value]) => {
      const props = value?.properties || {};
      return {
        key,
        required: required.has(key),
        authority: props.authority?.const || null,
        surface: props.table?.const || props.registry_surface?.const || props.tenant_surface?.const || props.role_surface?.const || props.route_surface?.const || null,
        ref: value?.$ref || null,
      };
    });
    return { file, states };
  } catch {
    return { file, states: [] };
  }
}

function header(repoRoot, files) {
  const unique = uniq(files);
  const shown = unique.slice(0, 10).map((file) => `\`${rel(repoRoot, file)}\``);
  if (unique.length > 10) shown.push(`_... +${unique.length - 10} more_`);
  return `> Generated text documentation. Do not edit this file manually.\n> Source hash: \`${hashFiles(repoRoot, unique)}\`\n> Source count: **${unique.length}**\n> Sources: ${shown.join(", ")}\n> Rendering: Mermaid plus Markdown tables; no image assets or raw database rows are generated.\n`;
}

function inventoryRows(objects) {
  return objects.map((object) => `| \`${object.name}\` | ${object.type} | ${esc(object.domain)} | ${object.sources.size} | ${object.columns.size || "-"} | ${object.refs.size ? [...object.refs].sort().map((ref) => `\`${ref}\``).join(", ") : "-"} |`).join("\n");
}

function renderSpecialized(repoRoot, catalog, spec) {
  const objects = [...catalog.tables, ...catalog.views].filter((object) => spec.pattern.test(object.name));
  const ranked = [...objects].sort((a, b) => (b.refs.size + b.sources.size) - (a.refs.size + a.sources.size) || a.name.localeCompare(b.name)).slice(0, 45);
  const names = new Set(ranked.map((object) => object.name));
  const nodes = ranked.map((object) => `  ${mermaidId(object.name)}["${object.name}<br/>${object.type}"]`).join("\n");
  const edges = ranked.flatMap((object) => [...object.refs].filter((ref) => names.has(ref)).map((ref) => `  ${mermaidId(object.name)} --> ${mermaidId(ref)}`)).sort().join("\n");
  const flowNodes = spec.flow.map((step, index) => `  c_${index}["${step}"]`).join("\n");
  const flowEdges = spec.flow.slice(1).map((_, index) => `  c_${index} --> c_${index + 1}`).join("\n");
  const sources = uniq(objects.flatMap((object) => [...object.sources]));
  return `# ${spec.title}\n\n${header(repoRoot, sources.length ? sources : catalog.files)}\n\`\`\`mermaid\nflowchart TD\n  subgraph OperatingFlow["Governed operating flow"]\n${flowNodes}\n${flowEdges}\n  end\n  subgraph DiscoveredSchema["Discovered schema objects"]\n${nodes || "  Empty[No matching schema objects discovered]"}\n${edges}\n  end\n\`\`\`\n\n## Discovered object inventory\n\n| Object | Type | Domain | Source migrations | Columns | References |\n|---|---|---|---:|---:|---|\n${objects.length ? inventoryRows(objects) : "| _none_ | - | - | 0 | 0 | - |"}\n\n## Coverage counters\n\n- Matching schema objects: **${objects.length}**\n- Diagram objects shown: **${ranked.length}**\n- Source migrations: **${sources.length}**\n`;
}

function renderDataModel(repoRoot, catalog) {
  const all = [...catalog.tables, ...catalog.views];
  const domains = uniq(all.map((object) => object.domain));
  const nodes = domains.map((domain) => {
    const tables = catalog.tables.filter((item) => item.domain === domain).length;
    const views = catalog.views.filter((item) => item.domain === domain).length;
    return `  ${mermaidId(domain)}["${domain}<br/>${tables} tables / ${views} views"]`;
  }).join("\n");
  const rows = domains.map((domain) => {
    const objects = all.filter((item) => item.domain === domain);
    return `| ${domain} | ${objects.filter((item) => item.type === "table").length} | ${objects.filter((item) => item.type === "view").length} | ${objects.slice(0, 10).map((item) => `\`${item.name}\``).join(", ")}${objects.length > 10 ? ", ..." : ""} |`;
  }).join("\n");
  return `# Platform Data Model Domain Map\n\n${header(repoRoot, catalog.files)}\n\`\`\`mermaid\nflowchart LR\n${nodes}\n\`\`\`\n\n## Domain summary\n\n| Domain | Tables | Views | Sample objects |\n|---|---:|---:|---|\n${rows}\n\n## Full schema inventory\n\n| Object | Type | Domain | Source migrations | Columns | References |\n|---|---|---|---:|---:|---|\n${inventoryRows(all)}\n`;
}

function renderMemory(repoRoot, catalog, memory) {
  const objects = [...catalog.tables, ...catalog.views].filter((object) => /session|conversation|turn|memory|scope_link|archive|insight|graph_memory|request_envelope/i.test(object.name));
  const sources = uniq([...objects.flatMap((object) => [...object.sources]), memory.file]);
  const states = memory.states.map((state) => `| \`${state.key}\` | ${state.required ? "yes" : "no"} | ${state.authority ? `\`${state.authority}\`` : "-"} | ${state.surface ? `\`${state.surface}\`` : "-"} | ${state.ref ? `\`${state.ref}\`` : "-"} |`).join("\n");
  return `# Session, Memory, and Insight Map\n\n${header(repoRoot, sources)}\n\`\`\`mermaid\nflowchart TD\n  Session[Session / conversation] --> Turns[Turns and transcript refs]\n  Turns --> Archive[Archive and offload]\n  Archive --> Scope[Memory scope resolution]\n  Scope --> Insight[Insight candidates]\n  Insight --> Graph[Graph memory]\n  Graph --> Runtime[Runtime context]\n  Runtime --> Evidence[Execution evidence]\n\`\`\`\n\n## Memory schema states\n\n| State | Required | Authority | Canonical surface | Reference |\n|---|---:|---|---|---|\n${states || "| _none_ | - | - | - | - |"}\n\n## Session and memory schema inventory\n\n| Object | Type | Domain | Source migrations | Columns | References |\n|---|---|---|---:|---:|---|\n${objects.length ? inventoryRows(objects) : "| _none_ | - | - | 0 | 0 | - |"}\n`;
}

function renderPolicy(repoRoot, catalog, content) {
  const policies = catalog.policies.map((policy) => `| \`${policy.key}\` | ${policy.sources.size} |`).join("\n");
  return `${content}\n## Discovered policy keys\n\n| Policy key | Source migrations |\n|---|---:|\n${policies || "| _none_ | 0 |"}\n`;
}

function renderCoverage(repoRoot, catalog, mapNames) {
  const all = [...catalog.tables, ...catalog.views];
  const domains = uniq(all.map((object) => object.domain));
  const rows = domains.map((domain) => {
    const objects = all.filter((item) => item.domain === domain);
    const maps = MAP_SPECS.filter((spec) => objects.some((object) => spec.pattern.test(object.name))).map((spec) => spec.file);
    if (domain === "Sessions & memory") maps.push("session-memory-map.md");
    maps.push("data-model-domain-map.md");
    const status = domain === "Other / uncategorized" ? "taxonomy gap" : "covered";
    return `| ${domain} | ${objects.filter((item) => item.type === "table").length} | ${objects.filter((item) => item.type === "view").length} | ${uniq(maps).map((name) => `\`${name}\``).join(", ")} | ${status} |`;
  }).join("\n");
  const uncategorized = all.filter((object) => object.domain === "Other / uncategorized");
  return `# Work Map Coverage Matrix\n\n${header(repoRoot, catalog.files)}\n## Domain coverage\n\n| Domain | Tables | Views | Generated maps | Status |\n|---|---:|---:|---|---|\n${rows}\n\n## Generated map inventory\n\n${mapNames.sort().map((name) => `- \`${name}\``).join("\n")}\n\n## Uncategorized schema objects\n\n${uncategorized.length ? uncategorized.map((object) => `- \`${object.name}\` (${object.type})`).join("\n") : "- None."}\n`;
}

export function buildSchemaIntelligenceMaps({ repoRoot }) {
  const catalog = parseCatalog(repoRoot);
  const memory = parseMemory(repoRoot);
  const maps = {
    "data-model-domain-map.md": renderDataModel(repoRoot, catalog),
    "session-memory-map.md": renderMemory(repoRoot, catalog, memory),
  };
  for (const spec of MAP_SPECS) {
    const content = renderSpecialized(repoRoot, catalog, spec);
    maps[spec.file] = spec.file === "policy-authority-map.md" ? renderPolicy(repoRoot, catalog, content) : content;
  }
  maps["work-map-coverage-matrix.md"] = renderCoverage(repoRoot, catalog, Object.keys(maps));
  const all = [...catalog.tables, ...catalog.views];
  const classified = all.filter((object) => object.domain !== "Other / uncategorized").length;
  return {
    maps,
    sourceFiles: uniq([...catalog.files, memory.file]),
    metrics: {
      migrations_scanned: catalog.files.length,
      tables_discovered: catalog.tables.length,
      views_discovered: catalog.views.length,
      policy_keys_discovered: catalog.policies.length,
      memory_states_discovered: memory.states.length,
      domain_count: uniq(all.map((object) => object.domain)).length,
      specialized_map_count: MAP_SPECS.length,
      uncategorized_objects: all.length - classified,
      classified_objects: classified,
      classification_coverage_percent: all.length ? Number(((classified / all.length) * 100).toFixed(2)) : 100,
    },
  };
}
