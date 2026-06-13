import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DOMAIN_RULES = [
  ["Activation & onboarding", /activation|onboarding|bootstrap|guidance|attention_rule|operational_tile|signal_inbox/i],
  ["Assets & packages", /asset|package|pack_attachment|copy_location|variant|equivalence/i],
  ["Commercial & usage", /commercial|credit|usage|billing|pricing|meter|subscription|entitlement/i],
  ["Repository & development", /repo_|git|branch|source_registry|proposal|summary_development|runtime_ci|deployment_parity|install_diff/i],
  ["Platform resources & graph", /platform_graph|platform_resource|resource_recipe|resource_type|resource_adapter|contract_surface|registry_surfaces|capability|decision|intent|adaptation|platform_binding|platform_export|relationship_integrity|platform_runtime_config/i],
  ["Delivery & support", /ticket|thread|timeline|email_outbox|recipient_allowlist|external_delivery|sink_dispatch|output_artifact|reporting|tracked_event/i],
  ["Migration & lifecycle", /migration|database_table_lifecycle|database_lifecycle|checkpoint|validation_repair|recovery|repair_run/i],
  ["Tenancy & identity", /tenant|membership|user|role|workspace|actor|invitation|plan|assistance/i],
  ["Brand & business", /brand|business_activity|business_type|customer|contact|campaign|audience|persona|segment|market/i],
  ["Agents & intelligence", /agent|skill|plugin|logic|engine|model|prompt|knowledge|intelligence/i],
  ["Workflow & tasks", /workflow|task|route|step|approval|job|orchestrat|execution_plan|execution_enablement/i],
  ["Connectors & providers", /connector|connected_system|installation|credential|provider|app_integration|user_app_connection|webhook|oauth|cloudflare|hostinger|wordpress|n8n|local_gateway|device|browser_runtime|remote_runtime|local_project_path|cms_|site_inspection/i],
  ["Governance & authority", /policy|permission|grant|authority|quota|budget|compliance|access|rate_limit|auth_|secret_reference|platform_secrets|preflight/i],
  ["Sessions & memory", /session|conversation|turn|memory|scope_link|archive|insight|graph_memory|request_envelope/i],
  ["Observability & release", /execution_log|audit|telemetry|incident|readiness|monitor|release|backup|restore|snapshot|health|certification|diagnostic|evidence|dr_/i],
  ["Developer & API", /developer|api_|endpoint|tool|schema|upload|openapi/i],
];

const SPECIALIZED_MAPS = [
  {
    file: "agent-skill-plugin-map.md",
    title: "Agent, Skill, Plugin, and Intelligence Map",
    pattern: /agent|skill|plugin|logic|engine|model|prompt|knowledge/i,
    flow: ["Intent", "Agent resolution", "Skill grants", "Logic / engine", "Model policy", "Tool / plugin binding", "Execution evidence"],
    invariants: [
      "Agent execution resolves bindings before model or tool dispatch.",
      "Skills and plugins are authorization surfaces, not descriptive metadata only.",
      "Model selection remains behind engine and policy resolution.",
      "Execution evidence records agent, skill, plugin, logic, engine, and model attribution.",
    ],
  },
  {
    file: "workflow-task-orchestration-map.md",
    title: "Workflow, Task, and Orchestration Map",
    pattern: /workflow|task|route|step|approval|job|orchestrat|execution_plan|snapshot/i,
    flow: ["Intent / event", "Task route", "Execution plan", "Workflow binding", "Step runs", "Approval / hold", "Snapshot / readback"],
    invariants: [
      "Task routing precedes workflow execution.",
      "Runtime bindings and dependencies are validated before dispatch.",
      "Approval and hold surfaces remain explicit in the execution graph.",
      "Snapshots and readback surfaces provide post-run evidence.",
    ],
  },
  {
    file: "policy-authority-map.md",
    title: "Policy, Permission, and Authority Map",
    pattern: /policy|permission|grant|authority|quota|budget|entitlement|compliance|access|role_assignment|credential_binding|rate_limit/i,
    flow: ["Actor context", "Role / entitlement", "Permission grant", "Resource authority", "Budget / quota", "Runtime policy", "Allow / block evidence"],
    invariants: [
      "Access is deny-by-default until tenant, role, grant, and authority evidence resolves.",
      "Resource and budget authority remain distinct evidence dimensions.",
      "Credentials are referenced, never embedded in generated documentation.",
      "Blocking decisions must be visible in runtime evidence and readiness surfaces.",
    ],
  },
  {
    file: "connector-provider-map.md",
    title: "Connector, Provider, and Connected App Map",
    pattern: /connector|connected_system|installation|credential|provider|app_integration|user_app_connection|webhook|oauth|cloudflare|hostinger|wordpress|n8n|local_gateway|device/i,
    flow: ["App / provider", "Connected system", "Installation", "Credential binding", "Permission grant", "Connector route", "Provider result", "Execution evidence"],
    invariants: [
      "Provider transport is governed through registered connector routes.",
      "Connection, installation, credential reference, and permission evidence are separate.",
      "Generated maps expose schema and bindings only, never credential values.",
      "Local-device paths remain distinct from hosted provider paths.",
    ],
  },
  {
    file: "observability-release-map.md",
    title: "Observability, Audit, and Release Map",
    pattern: /execution_log|audit|telemetry|incident|readiness|monitor|release|backup|restore|snapshot|health|certification|diagnostic|evidence|dr_/i,
    flow: ["Runtime event", "Execution evidence", "Audit / telemetry", "Readiness views", "Incident / repair", "Release gate", "DR certification"],
    invariants: [
      "Operational claims require readback evidence, not narrative status.",
      "Release readiness aggregates schema, policy, migration, runtime, and DR evidence.",
      "Diagnostics are read-only unless an explicit governed recovery action is approved.",
      "Generated documentation contains no raw runtime rows.",
    ],
  },
  {
    file: "activation-onboarding-map.md",
    title: "Activation, Bootstrap, and Onboarding Map",
    pattern: /activation|onboarding|bootstrap|guidance|attention_rule|operational_tile|signal_inbox/i,
    flow: ["Session start", "Bootstrap authority", "Authorization envelope", "Surface discovery", "Onboarding state", "Attention / guidance", "Activation evidence"],
    invariants: [
      "Activation state is evidence-based and scoped to the authenticated principal.",
      "Bootstrap configuration and provider validation remain distinct evidence surfaces.",
      "Dynamic tabs, tiles, and guidance are registry-driven.",
      "Onboarding gaps remain visible until same-cycle validation closes them.",
    ],
  },
  {
    file: "asset-package-map.md",
    title: "Asset, Package, and Variant Map",
    pattern: /asset|package|pack_attachment|copy_location|variant|equivalence/i,
    flow: ["Source asset", "Subject / ownership link", "Package version", "Variant", "Patch / merge", "Private distribution", "Runtime consumption"],
    invariants: [
      "Assets retain explicit ownership, subject, and version relationships.",
      "Package variants and patches are auditable rather than implicit file copies.",
      "Private package distribution remains separate from public repository state.",
      "Generated maps expose identifiers and schema relationships only.",
    ],
  },
  {
    file: "commercial-usage-map.md",
    title: "Commercial, Credit, Entitlement, and Usage Map",
    pattern: /commercial|credit|usage|billing|pricing|meter|subscription|entitlement/i,
    flow: ["Commercial profile", "Plan / entitlement", "Credit balance", "Usage meter", "Limit / quota", "Eligibility decision", "Execution evidence"],
    invariants: [
      "Commercial eligibility resolves before paid, limited, or managed execution.",
      "Credit balances and usage ledgers are distinct accounting surfaces.",
      "Quota and budget authority remain visible in execution evidence.",
      "Generated documentation never includes customer billing rows.",
    ],
  },
  {
    file: "repository-development-map.md",
    title: "Repository, Development, and Deployment Map",
    pattern: /repo_|git|branch|source_registry|proposal|summary_development|runtime_ci|deployment_parity|install_diff/i,
    flow: ["Repository source", "Candidate / proposal", "Install diff", "Patch branch", "CI classification", "Merge gate", "Deployment parity", "Readback"],
    invariants: [
      "Repository mutations require governed capability envelopes.",
      "Branch freshness, CI, and release readiness precede merge or deployment claims.",
      "Install and capability candidates remain reviewable before activation.",
      "Deployment parity is verified separately from repository merge state.",
    ],
  },
  {
    file: "platform-resource-graph-map.md",
    title: "Platform Resource, Capability, and Graph Map",
    pattern: /platform_graph|platform_resource|resource_recipe|resource_type|resource_adapter|contract_surface|registry_surfaces|capability|decision|intent|adaptation/i,
    flow: ["Intent / decision", "Capability source resolution", "Contract surface", "Resource type", "Adapter / recipe", "Graph projection", "Validation / runtime evidence"],
    invariants: [
      "Capabilities resolve through registered sources and contract surfaces.",
      "Resource types, adapters, and recipes form explicit governed bindings.",
      "Graph projections are derived views, not replacement runtime authority.",
      "Validation results and gaps remain queryable as separate surfaces.",
    ],
  },
  {
    file: "delivery-support-map.md",
    title: "Output Delivery, Support, and Communication Map",
    pattern: /ticket|thread|timeline|email_outbox|recipient_allowlist|external_delivery|sink_dispatch|output_artifact|reporting|tracked_event/i,
    flow: ["Output artifact", "Recipient allowlist", "Sink routing", "Delivery event", "Ticket / thread", "Timeline / tracking", "Readback"],
    invariants: [
      "External delivery requires an allowlisted recipient and governed sink.",
      "Output artifacts and dispatch events remain separately auditable.",
      "Support tickets, threads, and timeline events retain linked resource context.",
      "Generated documentation contains no recipient addresses or message bodies.",
    ],
  },
  {
    file: "migration-lifecycle-map.md",
    title: "Migration, Data Lifecycle, and Recovery Map",
    pattern: /migration|database_table_lifecycle|checkpoint|validation_repair|recovery|repair_run/i,
    flow: ["Migration candidate", "Preflight", "Authorization", "Apply / record", "Lifecycle registry", "Checkpoint", "Repair / recovery", "Readiness"],
    invariants: [
      "Migration apply requires preflight, confirmation, and ledger evidence.",
      "Record-only entries are used only when same-cycle evidence proves the schema state already exists.",
      "Lifecycle ownership and recovery paths remain explicit.",
      "No destructive migration is inferred from documentation generation.",
    ],
  },
];

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

function rel(repoRoot, file) {
  return path.relative(repoRoot, file).replaceAll("\\", "/");
}

function hashFiles(repoRoot, files) {
  const hash = crypto.createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    hash.update(rel(repoRoot, file));
    hash.update("\0");
    hash.update(readText(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function esc(value = "") {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

function mermaidId(value = "") {
  return `n_${String(value).replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function classify(name) {
  return DOMAIN_RULES.find(([, pattern]) => pattern.test(name))?.[0] || "Other / uncategorized";
}

function singularize(name) {
  if (name.endsWith("ies")) return `${name.slice(0, -3)}y`;
  if (name.endsWith("sses")) return name.slice(0, -2);
  if (name.endsWith("s") && !name.endsWith("ss")) return name.slice(0, -1);
  return name;
}

function createTableBlocks(text) {
  const blocks = [];
  const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?\s*\(/gi;
  let match;
  while ((match = pattern.exec(text))) {
    let depth = 1;
    let quote = null;
    let escaped = false;
    let index = pattern.lastIndex;
    for (; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quote && char === "\\") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === "`") {
        quote = char;
        continue;
      }
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (depth === 0) break;
    }
    blocks.push({ name: match[1], body: text.slice(pattern.lastIndex, index) });
    pattern.lastIndex = Math.max(index + 1, pattern.lastIndex);
  }
  return blocks;
}

function parsePolicyKeys(text) {
  const keys = [];
  for (const match of text.matchAll(/['"]([A-Za-z0-9_.:-]+_policy_v\d+)['"]/gi)) keys.push(match[1]);
  for (const match of text.matchAll(/['"]([A-Z][A-Za-z0-9 /&:_-]{4,100}(?:Policy|Guard|Visibility|Governance))['"]/g)) keys.push(match[1]);
  return uniq(keys);
}

function parseMigrationCatalog(repoRoot) {
  const migrationDir = path.join(repoRoot, "http-generic-api/migrations");
  const files = listFiles(migrationDir, (file) => file.endsWith(".sql"));
  const tables = new Map();
  const views = new Map();
  const policies = new Map();

  const ensure = (map, name, type) => {
    if (!map.has(name)) map.set(name, { name, type, domain: classify(name), sources: new Set(), columns: new Set(), refs: new Set(), inferredRefs: new Set() });
    return map.get(name);
  };

  for (const file of files) {
    const text = readText(file);
    for (const block of createTableBlocks(text)) {
      const table = ensure(tables, block.name, "table");
      table.sources.add(file);
      for (const column of block.body.matchAll(/^\s*`([^`]+)`\s+/gm)) table.columns.add(column[1]);
      for (const ref of block.body.matchAll(/REFERENCES\s+`?([A-Za-z0-9_]+)`?/gi)) table.refs.add(ref[1]);
    }
    for (const match of text.matchAll(/ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?/gi)) ensure(tables, match[1], "table").sources.add(file);
    for (const match of text.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+`?([A-Za-z0-9_]+)`?/gi)) ensure(views, match[1], "view").sources.add(file);
    for (const key of parsePolicyKeys(text)) {
      if (!policies.has(key)) policies.set(key, { key, sources: new Set() });
      policies.get(key).sources.add(file);
    }
  }

  const aliases = new Map();
  for (const name of tables.keys()) {
    aliases.set(name, name);
    aliases.set(singularize(name), name);
  }
  for (const table of tables.values()) {
    for (const column of table.columns) {
      if (!column.endsWith("_id")) continue;
      const base = column.slice(0, -3);
      const target = aliases.get(base) || aliases.get(`${base}s`);
      if (target && target !== table.name && !table.refs.has(target)) table.inferredRefs.add(target);
    }
  }

  return {
    files,
    tables: [...tables.values()].sort((a, b) => a.name.localeCompare(b.name)),
    views: [...views.values()].sort((a, b) => a.name.localeCompare(b.name)),
    policies: [...policies.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

function parseMemoryStates(repoRoot) {
  const file = path.join(repoRoot, "memory_schema.json");
  if (!fs.existsSync(file)) return { file, states: [] };
  try {
    const schema = JSON.parse(readText(file));
    const required = new Set(schema.required || []);
    const states = Object.entries(schema.properties || {}).map(([key, value]) => {
      const props = value?.properties || {};
      const surface = props.table?.const || props.registry_surface?.const || props.tenant_surface?.const || props.role_surface?.const || props.route_surface?.const || null;
      return {
        key,
        required: required.has(key),
        ref: value?.$ref || null,
        authority: props.authority?.const || null,
        surface,
      };
    });
    return { file, states };
  } catch {
    return { file, states: [] };
  }
}

function summarizedSources(repoRoot, files, limit = 10) {
  const sourcePaths = uniq(files).map((file) => rel(repoRoot, file));
  const shown = sourcePaths.slice(0, limit).map((source) => `\`${source}\``);
  if (sourcePaths.length > limit) shown.push(`_... +${sourcePaths.length - limit} more_`);
  return shown.join(", ");
}

function header(repoRoot, files) {
  return [
    "> Generated text documentation. Do not edit this file manually.",
    `> Source hash: \`${hashFiles(repoRoot, files)}\``,
    `> Source count: **${uniq(files).length}**`,
    `> Sources: ${summarizedSources(repoRoot, files)}`,
    "> Rendering: Mermaid code blocks plus Markdown tables; no image assets or raw database rows are generated.",
    "",
  ].join("\n");
}

function relationRows(objects) {
  return objects.map((object) => {
    const refs = uniq([...object.refs, ...object.inferredRefs]);
    return `| \`${object.name}\` | ${object.type} | ${esc(object.domain)} | ${object.sources.size} | ${object.columns.size || "-"} | ${refs.length ? refs.map((ref) => `\`${ref}\``).join(", ") : "-"} |`;
  }).join("\n");
}

function renderDomainCatalog(repoRoot, catalog) {
  const all = [...catalog.tables, ...catalog.views];
  const domains = uniq(all.map((object) => object.domain));
  const domainCounts = new Map(domains.map((domain) => [domain, {
    tables: catalog.tables.filter((table) => table.domain === domain).length,
    views: catalog.views.filter((view) => view.domain === domain).length,
  }]));
  const cross = new Map();
  for (const table of catalog.tables) {
    for (const ref of uniq([...table.refs, ...table.inferredRefs])) {
      const target = catalog.tables.find((candidate) => candidate.name === ref);
      if (!target || target.domain === table.domain) continue;
      const key = `${table.domain}|||${target.domain}`;
      cross.set(key, (cross.get(key) || 0) + 1);
    }
  }
  const nodes = domains.map((domain) => {
    const count = domainCounts.get(domain);
    return `  ${mermaidId(domain)}["${domain}<br/>${count.tables} tables / ${count.views} views"]`;
  }).join("\n");
  const edges = [...cross.entries()].sort().map(([key, count]) => {
    const [from, to] = key.split("|||");
    return `  ${mermaidId(from)} -->|${count}| ${mermaidId(to)}`;
  }).join("\n");
  const summaryRows = domains.map((domain) => {
    const count = domainCounts.get(domain);
    const domainObjects = all.filter((object) => object.domain === domain);
    const names = domainObjects.slice(0, 12).map((object) => `\`${object.name}\``).join(", ");
    return `| ${esc(domain)} | ${count.tables} | ${count.views} | ${names}${domainObjects.length > 12 ? ", ..." : ""} |`;
  }).join("\n");
  return `# Platform Data Model Domain Map\n\n${header(repoRoot, catalog.files)}\n\`\`\`mermaid\nflowchart LR\n${nodes}\n${edges || "  NoCrossDomainRefs[No cross-domain references discovered]"}\n\`\`\`\n\n## Domain summary\n\n| Domain | Tables | Views | Sample objects |\n|---|---:|---:|---|\n${summaryRows}\n\n## Full schema inventory\n\n| Object | Type | Domain | Source migrations | Columns discovered | References |\n|---|---|---|---:|---:|---|\n${relationRows(all)}\n\n## Coverage counters\n\n- Migration files scanned: **${catalog.files.length}**\n- Tables discovered: **${catalog.tables.length}**\n- Views discovered: **${catalog.views.length}**\n- Policy keys discovered: **${catalog.policies.length}**\n- Uncategorized objects: **${all.filter((object) => object.domain === "Other / uncategorized").length}**\n`;
}

function renderSpecialized(repoRoot, catalog, spec) {
  const objects = [...catalog.tables, ...catalog.views].filter((object) => spec.pattern.test(object.name));
  const ranked = [...objects].sort((a, b) => {
    const aScore = a.refs.size + a.inferredRefs.size + a.sources.size;
    const bScore = b.refs.size + b.inferredRefs.size + b.sources.size;
    return bScore - aScore || a.name.localeCompare(b.name);
  }).slice(0, 45);
  const diagramNames = new Set(ranked.map((object) => object.name));
  const nodes = ranked.map((object) => `  ${mermaidId(object.name)}["${object.name}<br/>${object.type}"]`).join("\n");
  const edges = ranked.flatMap((object) => uniq([...object.refs, ...object.inferredRefs])
    .filter((ref) => diagramNames.has(ref))
    .map((ref) => `  ${mermaidId(object.name)} --> ${mermaidId(ref)}`)).sort().join("\n");
  const conceptual = spec.flow.map((step, index) => `  c_${index}["${step}"]`).join("\n");
  const conceptualEdges = spec.flow.slice(1).map((_, index) => `  c_${index} --> c_${index + 1}`).join("\n");
  const sources = uniq(objects.flatMap((object) => [...object.sources]));
  return `# ${spec.title}\n\n${header(repoRoot, sources.length ? sources : catalog.files)}\n\`\`\`mermaid\nflowchart TD\n  subgraph OperatingFlow["Governed operating flow"]\n${conceptual}\n${conceptualEdges}\n  end\n  subgraph DiscoveredSchema["Discovered schema objects"]\n${nodes || "  Empty[No matching schema objects discovered]"}\n${edges}\n  end\n\`\`\`\n\n## Runtime invariants\n\n${spec.invariants.map((item) => `- ${item}`).join("\n")}\n\n## Discovered object inventory\n\n| Object | Type | Domain | Source migrations | Columns discovered | References |\n|---|---|---|---:|---:|---|\n${objects.length ? relationRows(objects) : "| _none_ | - | - | 0 | 0 | - |"}\n\n## Coverage counters\n\n- Matching schema objects: **${objects.length}**\n- Diagram objects shown: **${ranked.length}**\n- Diagram truncation applied: **${objects.length > ranked.length ? "yes" : "no"}**\n- Source migrations: **${sources.length}**\n`;
}

function renderPolicyAuthority(repoRoot, catalog) {
  const spec = SPECIALIZED_MAPS.find((item) => item.file === "policy-authority-map.md");
  const base = renderSpecialized(repoRoot, catalog, spec);
  const rows = catalog.policies.map((policy) => `| \`${policy.key}\` | ${policy.sources.size} | ${summarizedSources(repoRoot, [...policy.sources], 3)} |`).join("\n");
  return `${base}\n## Discovered policy key inventory\n\n| Policy key | Source migrations | Sample sources |\n|---|---:|---|\n${rows || "| _none_ | 0 | - |"}\n`;
}

function renderSessionMemory(repoRoot, catalog, memory) {
  const objects = [...catalog.tables, ...catalog.views].filter((object) => /session|conversation|turn|memory|scope_link|archive|insight|graph_memory|request_envelope/i.test(object.name));
  const sources = uniq([...objects.flatMap((object) => [...object.sources]), memory.file].filter(Boolean));
  const stateNodes = memory.states.map((state) => `  ${mermaidId(state.key)}["${state.key}${state.required ? "<br/>required" : ""}"]`).join("\n");
  const stateEdges = memory.states.map((state) => state.surface ? `  ${mermaidId(state.key)} --> ${mermaidId(state.surface)}` : "").filter(Boolean).join("\n");
  const surfaceNodes = uniq(memory.states.map((state) => state.surface)).map((surface) => `  ${mermaidId(surface)}[("${surface}")]`).join("\n");
  const stateRows = memory.states.map((state) => `| \`${state.key}\` | ${state.required ? "yes" : "no"} | ${state.authority ? `\`${state.authority}\`` : "-"} | ${state.surface ? `\`${state.surface}\`` : "-"} | ${state.ref ? `\`${state.ref}\`` : "-"} |`).join("\n");
  return `# Session, Memory, and Insight Map\n\n${header(repoRoot, sources)}\n\`\`\`mermaid\nflowchart TD\n  Session[Session / conversation] --> Turns[Turns and transcript references]\n  Turns --> Archive[Archive and offload]\n  Archive --> Scope[Memory scope resolution]\n  Scope --> Insight[Insight candidates and promotion]\n  Insight --> Graph[Graph memory and linked assets]\n  Graph --> Runtime[Runtime context]\n  Runtime --> Evidence[Execution evidence]\n${stateNodes}\n${surfaceNodes}\n${stateEdges}\n\`\`\`\n\n## Memory schema states\n\n| State | Required | Authority | Canonical surface | Schema reference |\n|---|---:|---|---|---|\n${stateRows || "| _none_ | - | - | - | - |"}\n\n## Session and memory schema inventory\n\n| Object | Type | Domain | Source migrations | Columns discovered | References |\n|---|---|---|---:|---:|---|\n${objects.length ? relationRows(objects) : "| _none_ | - | - | 0 | 0 | - |"}\n\n## Coverage counters\n\n- Memory schema states: **${memory.states.length}**\n- Required memory states: **${memory.states.filter((state) => state.required).length}**\n- Session/memory schema objects: **${objects.length}**\n`;
}

function renderCoverageMatrix(repoRoot, catalog, mapNames) {
  const all = [...catalog.tables, ...catalog.views];
  const rows = uniq(all.map((object) => object.domain)).map((domain) => {
    const objects = all.filter((object) => object.domain === domain);
    const mapped = SPECIALIZED_MAPS.filter((spec) => objects.some((object) => spec.pattern.test(object.name))).map((spec) => spec.file);
    if (domain === "Sessions & memory") mapped.push("session-memory-map.md");
    mapped.push("data-model-domain-map.md");
    return `| ${esc(domain)} | ${objects.filter((object) => object.type === "table").length} | ${objects.filter((object) => object.type === "view").length} | ${uniq(mapped).map((name) => `\`${name}\``).join(", ")} | ${objects.length ? "covered" : "empty"} |`;
  }).join("\n");
  const uncategorized = all.filter((object) => object.domain === "Other / uncategorized");
  return `# Work Map Coverage Matrix\n\n${header(repoRoot, catalog.files)}\n## Domain coverage\n\n| Domain | Tables | Views | Generated maps | Status |\n|---|---:|---:|---|---|\n${rows}\n\n## Generated map inventory\n\n${mapNames.sort().map((name) => `- \`${name}\``).join("\n")}\n\n## Uncategorized schema objects\n\n${uncategorized.length ? uncategorized.map((object) => `- \`${object.name}\` (${object.type})`).join("\n") : "- None."}\n\n## Coverage policy\n\n- Every discovered table and view appears in the data-model map.\n- Specialized maps are generated from deterministic name-based domain filters.\n- Uncategorized objects remain visible here instead of being silently omitted.\n- Any source change modifies a source hash and creates a reviewable Markdown diff.\n- No raw database rows, credentials, provider payloads, or image files are generated.\n`;
}

export function buildSchemaIntelligenceMaps({ repoRoot }) {
  const catalog = parseMigrationCatalog(repoRoot);
  const memory = parseMemoryStates(repoRoot);
  const maps = {
    "data-model-domain-map.md": renderDomainCatalog(repoRoot, catalog),
    "session-memory-map.md": renderSessionMemory(repoRoot, catalog, memory),
  };
  for (const spec of SPECIALIZED_MAPS) {
    maps[spec.file] = spec.file === "policy-authority-map.md"
      ? renderPolicyAuthority(repoRoot, catalog)
      : renderSpecialized(repoRoot, catalog, spec);
  }
  maps["work-map-coverage-matrix.md"] = renderCoverageMatrix(repoRoot, catalog, Object.keys(maps));
  const allObjects = [...catalog.tables, ...catalog.views];
  return {
    maps,
    sourceFiles: uniq([...catalog.files, memory.file].filter(Boolean)),
    metrics: {
      migrations_scanned: catalog.files.length,
      tables_discovered: catalog.tables.length,
      views_discovered: catalog.views.length,
      policy_keys_discovered: catalog.policies.length,
      memory_states_discovered: memory.states.length,
      domain_count: uniq(allObjects.map((object) => object.domain)).length,
      specialized_map_count: SPECIALIZED_MAPS.length,
      uncategorized_objects: allObjects.filter((object) => object.domain === "Other / uncategorized").length,
      classified_objects: allObjects.filter((object) => object.domain !== "Other / uncategorized").length,
    },
  };
}
