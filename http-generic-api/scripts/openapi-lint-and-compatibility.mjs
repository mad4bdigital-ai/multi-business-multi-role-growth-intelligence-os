#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const SELF = fileURLToPath(import.meta.url);
const API_DIR = path.resolve(path.dirname(SELF), '..');
const ROOT = path.resolve(API_DIR, '..');

export const DEFAULT_CONTRACT_PATH = path.join(
  ROOT,
  'specs/006-adaptive-authorization-execution-governance/contracts/authorization-execution.openapi.yaml',
);
export const DEFAULT_BASELINE_PATH = path.join(
  ROOT,
  'specs/006-adaptive-authorization-execution-governance/contracts/authorization-execution.openapi.baseline.json',
);
export const BASELINE_CONFIRMATION = 'UPDATE_OPENAPI_COMPATIBILITY_BASELINE';
export const BASELINE_COMPONENTS = [
  'Subject', 'Action', 'Resource', 'AuthorizationDecisionRequest',
  'AuthorizationDecision', 'ExecutionEnvelope', 'ApprovalDecision',
  'Execution', 'ExecutionEvidence', 'CursorPage', 'ErrorEnvelope',
];

const METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const obj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const uniq = (values) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

export function resolveInternalRef(document, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  return ref.slice(2).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((value, part) => (value == null ? undefined : value[part]), document);
}

function deref(document, value) {
  const seen = new Set();
  let current = value;
  while (obj(current) && typeof current.$ref === 'string' && current.$ref.startsWith('#/')) {
    if (seen.has(current.$ref)) break;
    seen.add(current.$ref);
    const next = resolveInternalRef(document, current.$ref);
    if (next === undefined) break;
    current = next;
  }
  return current;
}

function operations(document) {
  const result = [];
  for (const [route, item] of Object.entries(document.paths ?? {})) {
    if (!obj(item)) continue;
    for (const [method, operation] of Object.entries(item)) {
      if (METHODS.has(method.toLowerCase()) && obj(operation)) {
        result.push({ route, item, method: method.toLowerCase(), operation });
      }
    }
  }
  return result;
}

function parameters(document, item, operation) {
  return [
    ...(Array.isArray(item.parameters) ? item.parameters : []),
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ].map((value) => deref(document, value)).filter(obj);
}

function required(document, schema) {
  const value = deref(document, schema);
  return uniq(Array.isArray(value?.required) ? value.required.map(String) : []);
}

function typeOf(schema) {
  if (!obj(schema)) return 'unknown';
  if (typeof schema.$ref === 'string') return `ref:${schema.$ref}`;
  if (Array.isArray(schema.type)) return uniq(schema.type.map(String)).join('|');
  return typeof schema.type === 'string' ? schema.type : 'unknown';
}

function component(document, name) {
  const schema = document.components?.schemas?.[name];
  if (!obj(schema)) return null;
  const properties = {};
  for (const key of Object.keys(schema.properties ?? {}).sort()) {
    const property = schema.properties[key];
    properties[key] = {
      type: typeOf(property),
      enum: uniq(Array.isArray(property?.enum) ? property.enum.map((value) => JSON.stringify(value)) : []),
    };
  }
  return { required: required(document, schema), properties };
}

function successResponses(document, operation) {
  const result = {};
  for (const [status, raw] of Object.entries(operation.responses ?? {})) {
    if (!/^2\d\d$/.test(status)) continue;
    const response = deref(document, raw);
    const schema = response?.content?.['application/json']?.schema;
    result[status] = {
      schemaRef: obj(schema) && typeof schema.$ref === 'string' ? schema.$ref : null,
      requiredProperties: required(document, schema),
    };
  }
  return result;
}

export function buildCompatibilitySnapshot(document, options = {}) {
  const operationMap = {};
  for (const { route, item, method, operation } of operations(document)) {
    const body = deref(document, operation.requestBody);
    const schema = body?.content?.['application/json']?.schema;
    operationMap[`${method.toUpperCase()} ${route}`] = {
      operationId: operation.operationId ?? null,
      requiredParameters: uniq(
        parameters(document, item, operation)
          .filter((parameter) => parameter.required === true)
          .map((parameter) => `${parameter.in}:${parameter.name}`),
      ),
      requestBodyRequired: body?.required === true,
      requiredRequestProperties: required(document, schema),
      successResponses: successResponses(document, operation),
    };
  }
  return {
    schemaVersion: 1,
    contract: options.contractName ?? path.basename(DEFAULT_CONTRACT_PATH),
    generatedFrom: {
      openapi: document.openapi ?? null,
      infoVersion: document.info?.version ?? null,
    },
    operations: operationMap,
    components: Object.fromEntries(BASELINE_COMPONENTS.map((name) => [name, component(document, name)])),
  };
}

function compareSets(baseline, current, issues, added, removed) {
  const before = new Set(baseline ?? []);
  const after = new Set(current ?? []);
  if (added) for (const value of after) if (!before.has(value)) issues.push(added(value));
  if (removed) for (const value of before) if (!after.has(value)) issues.push(removed(value));
}

export function checkCompatibility(document, baseline) {
  const current = buildCompatibilitySnapshot(document, { contractName: baseline?.contract });
  const issues = [];
  if (!obj(baseline) || baseline.schemaVersion !== 1) {
    return { issues: ['Compatibility baseline must use schemaVersion 1.'], current };
  }

  for (const [key, expected] of Object.entries(baseline.operations ?? {})) {
    const actual = current.operations[key];
    if (!actual) {
      issues.push(`Breaking change: operation removed: ${key}.`);
      continue;
    }
    if (actual.operationId !== expected.operationId) {
      issues.push(`Breaking change: ${key} operationId changed.`);
    }
    compareSets(
      expected.requiredParameters, actual.requiredParameters, issues,
      (value) => `Breaking change: ${key} added required parameter ${value}.`,
      (value) => `Breaking change: ${key} removed required parameter ${value}.`,
    );
    if (Boolean(actual.requestBodyRequired) !== Boolean(expected.requestBodyRequired)) {
      issues.push(`Breaking change: ${key} requestBody.required changed.`);
    }
    compareSets(
      expected.requiredRequestProperties, actual.requiredRequestProperties, issues,
      (value) => `Breaking change: ${key} added required request property ${value}.`,
      null,
    );
    for (const [status, expectedResponse] of Object.entries(expected.successResponses ?? {})) {
      const actualResponse = actual.successResponses?.[status];
      if (!actualResponse) {
        issues.push(`Breaking change: ${key} removed success response ${status}.`);
        continue;
      }
      if ((actualResponse.schemaRef ?? null) !== (expectedResponse.schemaRef ?? null)) {
        issues.push(`Breaking change: ${key} ${status} response schema reference changed.`);
      }
      compareSets(
        expectedResponse.requiredProperties, actualResponse.requiredProperties, issues,
        null,
        (value) => `Breaking change: ${key} ${status} response removed required property ${value}.`,
      );
    }
  }

  for (const [name, expected] of Object.entries(baseline.components ?? {})) {
    const actual = current.components[name];
    if (!actual) {
      issues.push(`Breaking change: component schema removed: ${name}.`);
      continue;
    }
    compareSets(
      expected.required, actual.required, issues,
      (value) => `Breaking change: ${name} added required property ${value}.`,
      (value) => `Breaking change: ${name} removed required property ${value}.`,
    );
    for (const [propertyName, expectedProperty] of Object.entries(expected.properties ?? {})) {
      const actualProperty = actual.properties?.[propertyName];
      if (!actualProperty) {
        issues.push(`Breaking change: ${name}.${propertyName} was removed.`);
        continue;
      }
      if (actualProperty.type !== expectedProperty.type) {
        issues.push(`Breaking change: ${name}.${propertyName} type changed from ${expectedProperty.type} to ${actualProperty.type}.`);
      }
      const actualEnum = new Set(actualProperty.enum ?? []);
      for (const value of expectedProperty.enum ?? []) {
        if (!actualEnum.has(value)) {
          issues.push(`Breaking change: ${name}.${propertyName} removed enum value ${value}.`);
        }
      }
    }
  }
  return { issues, current };
}

function walk(value, visit, location = '#') {
  visit(value, location);
  if (Array.isArray(value)) {
    value.forEach((child, index) => walk(child, visit, `${location}/${index}`));
  } else if (obj(value)) {
    for (const [key, child] of Object.entries(value)) {
      walk(child, visit, `${location}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    }
  }
}

export function lintOpenApi(document) {
  const issues = [];
  if (!/^3\.1(?:\.|$)/.test(String(document?.openapi ?? ''))) issues.push('openapi must declare version 3.1.x.');
  if (!document?.info?.title) issues.push('info.title is required.');
  if (!document?.info?.version) issues.push('info.version is required.');
  if (!obj(document?.paths)) issues.push('paths must be an object.');
  if (!Array.isArray(document?.security) || document.security.length === 0) issues.push('Top-level security is required.');
  if (!obj(document?.components?.securitySchemes) || Object.keys(document.components.securitySchemes).length === 0) {
    issues.push('components.securitySchemes is required.');
  }

  const seen = new Map();
  for (const { route, item, method, operation } of operations(document ?? {})) {
    const key = `${method.toUpperCase()} ${route}`;
    const id = operation.operationId;
    if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(id)) {
      issues.push(`${key} must define a syntactically valid operationId.`);
    } else if (seen.has(id)) {
      issues.push(`${key} duplicates operationId ${id} already used by ${seen.get(id)}.`);
    } else {
      seen.set(id, key);
    }
    if (!operation.summary) issues.push(`${key} must define summary.`);
    if (!Array.isArray(operation.tags) || operation.tags.length === 0) issues.push(`${key} must define at least one tag.`);
    if (!Object.keys(operation.responses ?? {}).some((status) => /^2\d\d$/.test(status))) {
      issues.push(`${key} must define an explicit 2xx response.`);
    }
    if (operation.requestBody !== undefined) {
      const body = deref(document, operation.requestBody);
      if (!obj(body?.content?.['application/json'])) issues.push(`${key} requestBody must use application/json.`);
    }
    const declared = parameters(document, item, operation).filter((parameter) => parameter.in === 'path');
    for (const match of route.matchAll(/\{([^}]+)\}/g)) {
      const parameter = declared.find((candidate) => candidate.name === match[1]);
      if (!parameter) issues.push(`${key} path parameter ${match[1]} is not declared.`);
      else if (parameter.required !== true) issues.push(`${key} path parameter ${match[1]} must set required: true.`);
    }
  }

  walk(document, (value, location) => {
    if (!obj(value)) return;
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/') && resolveInternalRef(document, value.$ref) === undefined) {
      issues.push(`${location} contains unresolved internal $ref ${value.$ref}.`);
    }
    if (Array.isArray(value.required)) {
      if (!obj(value.properties)) {
        issues.push(`${location} defines required without properties.`);
      } else {
        for (const name of value.required) {
          if (!Object.hasOwn(value.properties, name)) issues.push(`${location} requires missing property ${name}.`);
        }
      }
    }
  });
  return uniq(issues);
}

function parseArgs(argv) {
  const options = {
    contractPath: DEFAULT_CONTRACT_PATH,
    baselinePath: DEFAULT_BASELINE_PATH,
    writeBaseline: false,
    confirm: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--write-baseline') options.writeBaseline = true;
    else if (value === '--contract') options.contractPath = path.resolve(argv[++index]);
    else if (value.startsWith('--contract=')) options.contractPath = path.resolve(value.slice(11));
    else if (value === '--baseline') options.baselinePath = path.resolve(argv[++index]);
    else if (value.startsWith('--baseline=')) options.baselinePath = path.resolve(value.slice(11));
    else if (value === '--confirm') options.confirm = argv[++index];
    else if (value.startsWith('--confirm=')) options.confirm = value.slice(10);
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

function printIssues(label, issues) {
  console.error(`${label} (${issues.length})`);
  issues.forEach((issue) => console.error(`- ${issue}`));
}

export function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const document = YAML.parse(fs.readFileSync(options.contractPath, 'utf8'));
  const lintIssues = lintOpenApi(document);
  if (lintIssues.length > 0) {
    printIssues('OpenAPI lint issues', lintIssues);
    return 1;
  }

  if (options.writeBaseline) {
    if (options.confirm !== BASELINE_CONFIRMATION) {
      console.error(`Refusing baseline update without --confirm=${BASELINE_CONFIRMATION}.`);
      return 1;
    }
    const baseline = buildCompatibilitySnapshot(document, { contractName: path.basename(options.contractPath) });
    fs.writeFileSync(options.baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`OpenAPI lint passed. Compatibility baseline written to ${options.baselinePath}.`);
    return 0;
  }

  if (!fs.existsSync(options.baselinePath)) {
    console.error(`Compatibility baseline not found: ${options.baselinePath}`);
    return 1;
  }
  const baseline = JSON.parse(fs.readFileSync(options.baselinePath, 'utf8'));
  const compatibility = checkCompatibility(document, baseline);
  if (compatibility.issues.length > 0) {
    printIssues('OpenAPI compatibility issues', compatibility.issues);
    return 1;
  }
  console.log('OpenAPI lint passed with 0 issues.');
  console.log('OpenAPI compatibility check passed with 0 issues.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SELF)) {
  process.exitCode = run();
}
