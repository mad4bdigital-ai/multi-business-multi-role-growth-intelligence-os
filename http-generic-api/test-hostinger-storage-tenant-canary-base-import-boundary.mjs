#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', 'coverage', 'dist', 'build']);
const FORBIDDEN_MODULES = Object.freeze([
  'hostingerStorageTenantCanaryBase',
  'hostingerStorageTenantCanaryPolicyBase',
]);
const ALLOWED_IMPORTERS = new Map([
  ['hostingerStorageTenantCanaryBase', new Set(['http-generic-api/hostingerStorageTenantCanary.js'])],
  ['hostingerStorageTenantCanaryPolicyBase', new Set(['http-generic-api/hostingerStorageTenantCanaryPolicy.js'])],
]);

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function scriptKind(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return ts.ScriptKind.TS;
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  return ts.ScriptKind.JS;
}

function collectConstBindings(sourceFile) {
  const bindings = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isVariableDeclarationList(node.parent)
      && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      bindings.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return bindings;
}

function unwrap(node) {
  let current = node;
  while (current
    && (ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isNonNullExpression(current)
      || ts.isSatisfiesExpression(current))) {
    current = current.expression;
  }
  return current;
}

function evaluateConstantString(node, bindings, seen = new Set()) {
  const current = unwrap(node);
  if (!current) return null;
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evaluateConstantString(current.left, bindings, seen);
    const right = evaluateConstantString(current.right, bindings, seen);
    return left === null || right === null ? null : `${left}${right}`;
  }
  if (ts.isTemplateExpression(current)) {
    let value = current.head.text;
    for (const span of current.templateSpans) {
      const expression = evaluateConstantString(span.expression, bindings, seen);
      if (expression === null) return null;
      value += expression + span.literal.text;
    }
    return value;
  }
  if (ts.isIdentifier(current) && bindings.has(current.text) && !seen.has(current.text)) {
    const nextSeen = new Set(seen);
    nextSeen.add(current.text);
    return evaluateConstantString(bindings.get(current.text), bindings, nextSeen);
  }
  if (ts.isNewExpression(current)
    && ts.isIdentifier(current.expression)
    && current.expression.text === 'URL'
    && current.arguments?.length) {
    return evaluateConstantString(current.arguments[0], bindings, seen);
  }
  if (ts.isCallExpression(current)
    && ts.isPropertyAccessExpression(current.expression)
    && current.expression.name.text === 'resolve'
    && current.arguments.length) {
    return evaluateConstantString(current.arguments[0], bindings, seen);
  }
  return null;
}

function isImportLikeCall(node) {
  if (!ts.isCallExpression(node)) return false;
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isIdentifier(node.expression) && node.expression.text === 'require') return true;
  if (ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'resolve'
    && (ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'require'
      || node.expression.expression.kind === ts.SyntaxKind.MetaProperty)) return true;
  return false;
}

function forbiddenModule(specifier) {
  const normalized = String(specifier || '').replaceAll('\\', '/');
  return FORBIDDEN_MODULES.find((moduleName) => normalized.includes(moduleName)) || null;
}

function findForbiddenImports({ source, filePath }) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(filePath),
  );
  const bindings = collectConstBindings(sourceFile);
  const findings = [];

  function record(node, expression) {
    const specifier = evaluateConstantString(expression, bindings);
    if (specifier === null) return;
    const moduleName = forbiddenModule(specifier);
    if (!moduleName) return;
    const relativePath = normalizePath(path.relative(repositoryRoot, filePath));
    if (ALLOWED_IMPORTERS.get(moduleName)?.has(relativePath)) return;
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({
      file: relativePath,
      line: position.line + 1,
      column: position.character + 1,
      module: moduleName,
      specifier,
    });
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier) record(node, node.moduleSpecifier);
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) record(node, node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression) record(node, node.moduleReference.expression);
    if (isImportLikeCall(node) && node.arguments.length) record(node, node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return findings;
}

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) walk(path.join(directory, entry.name), output);
      continue;
    }
    const filePath = path.join(directory, entry.name);
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) output.push(filePath);
  }
  return output;
}

const tenantBaseFile = 'hostingerStorageTenantCanaryBase' + '.js';
const selfTests = [
  `import('../http-generic-api/${tenantBaseFile}')`,
  "import('../http-generic-api/hostingerStorageTenantCanaryBase' + '.js')",
  "const stem = '../http-generic-api/hostingerStorageTenantCanary'; const suffix = 'Base.js'; import(stem + suffix)",
  "require('../http-generic-api/hostingerStorageTenantCanaryPolicyBase' + '.js')",
  `import(new URL('../http-generic-api/${tenantBaseFile}', import.meta.url))`,
];
for (const [index, source] of selfTests.entries()) {
  const findings = findForbiddenImports({
    source,
    filePath: path.join(repositoryRoot, `scripts/self-test-${index}.cjs`),
  });
  assert.equal(findings.length, 1, `Import-aware self-test ${index} must detect the Base bypass.`);
}

const findings = walk(repositoryRoot)
  .flatMap((filePath) => findForbiddenImports({
    source: fs.readFileSync(filePath, 'utf8'),
    filePath,
  }));

if (findings.length) {
  console.error(JSON.stringify({
    ok: false,
    gate: 'hostinger_storage_tenant_canary_base_import_boundary',
    findings,
    secrets_included: false,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_canary_base_import_boundary',
  parser: 'typescript_ast',
  static_imports_checked: true,
  dynamic_imports_checked: true,
  commonjs_require_checked: true,
  constant_string_concatenation_resolved: true,
  const_identifier_bindings_resolved: true,
  new_url_specifiers_resolved: true,
  source_extensions: [...SOURCE_EXTENSIONS].sort(),
  secrets_included: false,
}));
