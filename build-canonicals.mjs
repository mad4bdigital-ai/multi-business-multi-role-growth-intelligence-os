import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

const CANONICALS = [
  {
    output: 'system_bootstrap.md',
    sourceDir: 'canonicals/system_bootstrap',
    index: [
      ['Header and purpose', '00_header_purpose.md', 'Canonical identity, status, and purpose.'],
      ['Logic pointers and knowledge profiles', '01_logic_pointer_knowledge.md', 'Logic pointer authority, knowledge profiles, brand onboarding, and asset-read governance.'],
      ['Activation transport', '02_activation_transport.md', 'Activation transport, tool-first behavior, continuation override, and readiness guards.'],
      ['Audit, logging, and schema', '03_audit_logging_schema.md', 'Full-system audit authority, execution logging, parent actions, and HTTP schema gates.'],
      ['Registry foundation', '04_registry_foundation.md', 'Registry workbook authority, schema governance, strict routing, and policy surfaces.'],
      ['Activation runtime', '05_activation_runtime.md', 'Activation bootstrap, integrity, repairability, starter policy, and provider continuity.'],
      ['HTTP Generic API', '06_http_generic_api.md', 'HTTP Generic API governance, endpoint registry validation, and security constraints.'],
      ['Governed additions and graph', '07_governed_additions_graph.md', 'Governed addition pipeline, promotion, graph nodes, and graph routing.'],
      ['Google Workspace runtime', '08_google_workspace_runtime.md', 'Google Workspace native action governance and runtime validation dependencies.'],
      ['Growth execution authority', '09_growth_execution_authority.md', 'Growth feedback, scoring, authority model, workflow registry, and binding integrity.'],
      ['Observability and repair', '10_observability_repair.md', 'Observability, review surfaces, validation states, fallback handling, and repair signals.'],
      ['Analytics and API retirement', '11_analytics_api_retirement.md', 'Brand tracking bindings, API retirement, analytics warehouse governance, and URL authority.'],
      ['Runtime validation enforcer', '12_runtime_validation_enforcer.md', 'Runtime validation lifecycle, pre-write checks, readback, schema loading, and completion lock.'],
      ['WordPress publish contract', '13_wordpress_publish_contract.md', 'WordPress publish contract runtime governance patch.'],
    ],
  },
  {
    output: 'direct_instructions_registry_patch.md',
    sourceDir: 'canonicals/direct_instructions_registry_patch',
    index: [
      ['Header and purpose', '00_header_purpose.md', 'Canonical identity, status, and direct patch purpose.'],
      ['Governance foundation', '01_governance_foundation.md', 'Canonical presentation, pointer authority, brand core, activation, and early logging governance.'],
      ['HTTP execution and logging', '02_http_execution_logging.md', 'Parent action schema, auth routing, HTTP execution classification, and logging surfaces.'],
      ['Registry authority and schema', '03_registry_authority_schema.md', 'Registry source of truth, duplicate headers, dynamic placeholders, runtime bindings, and schema governance.'],
      ['Activation policy runtime', '04_activation_policy_runtime.md', 'Activation bootstrap, live canonical validation, full-system integrity, scoring, and retry governance.'],
      ['HTTP Generic API additions', '05_http_generic_api_additions.md', 'HTTP Generic API, adaptive schema learning, governed additions, and graph governance.'],
      ['Google Workspace validation', '06_google_workspace_validation.md', 'Google Workspace governance, runtime validation, post-activation governance, and growth feedback.'],
      ['Authority, binding, and repair', '07_authority_binding_repair.md', 'Authority model, routes and chains, target scopes, observability, repair, and recovery.'],
      ['Analytics and WordPress preflight', '08_analytics_wordpress_preflight.md', 'Brand tracking, API retirement, analytics governance, URL migration, and WordPress preflight.'],
      ['WordPress publish contract', '09_wordpress_publish_contract.md', 'WordPress publish contract direct instruction patch.'],
    ],
  },
  {
    output: 'module_loader.md',
    sourceDir: 'canonicals/module_loader',
    index: [
      ['Header and purpose', '00_header_purpose.md', 'Canonical identity, status, purpose, and initial loader readiness.'],
      ['Dependency resolution', '01_dependency_resolution.md', 'Credential chains, variable contracts, async dependencies, and Google Workspace dependency resolution.'],
      ['Live canonical and API resolution', '02_live_canonical_api_resolution.md', 'Live canonical resolution, API capability and endpoint resolution, embedded auth, and analytics sheet transformation.'],
      ['Schema and logging enforcement', '03_schema_logging_enforcement.md', 'Analytics identity enforcement, schema loading, and native Google logging preparation.'],
      ['WordPress publish contract', '04_wordpress_publish_contract.md', 'WordPress runtime governance loader bindings and sink contracts.'],
    ],
  },
  {
    output: 'prompt_router.md',
    sourceDir: 'canonicals/prompt_router',
    index: [
      ['Header and purpose', '00_header_purpose.md', 'Canonical identity, status, purpose, and initial routing posture.'],
      ['Core routing', '01_core_routing.md', 'HTTP variable-aware routing, async routing, and Native Google routing clarification.'],
      ['Runtime validation routing', '02_runtime_validation_routing.md', 'Runtime validation declaration, full audit routing, provider continuity, and analytics routing.'],
      ['Repair and review routing', '03_repair_review_routing.md', 'Repair loop guards, forced repair routing, escalation, review surfaces, and review write planning.'],
      ['Schema-first routing', '04_schema_first_routing.md', 'Schema-first routing rule.'],
      ['WordPress publish contract', '05_wordpress_publish_contract.md', 'WordPress publish contract routing patch.'],
    ],
  },
];

function sourcePath(config, file) {
  return `${config.sourceDir}/${file}`;
}

function renderDomainIndex(config) {
  const rows = config.index
    .map(([domain, file, useWhen]) => `| ${domain} | \`${sourcePath(config, file)}\` | ${useWhen} |`)
    .join('\n');

  return [
    '## Domain Index',
    '',
    `This file is generated from \`${config.sourceDir}/\`.`,
    'Edit source files under `canonicals/`; do not edit this root file directly.',
    '',
    '| Domain | Source file | Use when |',
    '|---|---|---|',
    rows,
    '',
    '---',
    '',
  ].join('\n');
}

function normalizeOutputNewlines(content) {
  return content.replace(/\r\n/g, '\n');
}

async function assertIndexFilesExist(config, files) {
  const sourceFiles = new Set(files);
  for (const [, file] of config.index) {
    if (!sourceFiles.has(file)) {
      throw new Error(`${config.output} Domain Index references missing source file: ${file}`);
    }
  }
}

async function readSourceFiles(config) {
  const dir = path.join(ROOT, config.sourceDir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();

  if (files.length === 0) {
    throw new Error(`No markdown source files found in ${config.sourceDir}`);
  }

  await assertIndexFilesExist(config, files);

  const parts = [];
  for (const file of files) {
    if (!/^\d{2}_[a-z0-9_]+\.md$/.test(file)) {
      throw new Error(`Source file must use numeric prefix naming: ${config.sourceDir}/${file}`);
    }

    const fullPath = path.join(dir, file);
    const content = await fs.readFile(fullPath, 'utf8');
    if (content.trim().length === 0) {
      throw new Error(`Source file is empty: ${config.sourceDir}/${file}`);
    }

    parts.push(content);
  }

  return { files, parts };
}

async function buildCanonical(config) {
  const { files, parts } = await readSourceFiles(config);
  const output = [
    '<!-- GENERATED FILE. Edit canonicals sources and run node build-canonicals.mjs. -->',
    '',
    renderDomainIndex(config),
    parts.join(''),
  ].join('\n');

  const normalizedOutput = normalizeOutputNewlines(output.endsWith('\n') ? output : `${output}\n`);
  await fs.writeFile(path.join(ROOT, config.output), normalizedOutput, 'utf8');
  console.log(`Built ${config.output} from ${files.length} source files.`);
}

for (const config of CANONICALS) {
  await buildCanonical(config);
}
