#!/usr/bin/env node
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Missing transformation anchor: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Ambiguous transformation anchor: ${label}`);
  return `${source.slice(0, index)}${after}${source.slice(index + before.length)}`;
}

function replaceRegexOnce(source, pattern, after, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Expected one ${label} match, found ${matches.length}`);
  return source.replace(pattern, after);
}

function replaceFunctionBodyPrefix(source, functionName, before, after, label) {
  const functionIndex = source.indexOf(`function ${functionName}`);
  if (functionIndex < 0) throw new Error(`Missing function: ${functionName}`);
  const index = source.indexOf(before, functionIndex);
  if (index < 0) throw new Error(`Missing ${label} after ${functionName}`);
  return `${source.slice(0, index)}${after}${source.slice(index + before.length)}`;
}

function patchWrapper() {
  const path = 'http-generic-api/hostingerStorageSharedCanary.js';
  let source = read(path);
  source = replaceOnce(
    source,
    '  createMemoryHostingerStorageSharedCanaryEnablementRegistry,\n',
    '  createMemoryHostingerStorageSharedCanaryEnablementRegistry as createCoreEnablementRegistry,\n',
    'Core enablement alias',
  );
  source = replaceOnce(
    source,
    "} from './hostingerStorageSharedCanaryCore.js';\n\nexport { HOSTINGER_STORAGE_SHARED_CANARY_VERSION, createMemoryHostingerStorageSharedCanaryEnablementRegistry };\n",
    "} from './hostingerStorageSharedCanaryCore.js';\nimport { isCanonicalHostingerStorageSyntheticAdapter } from './hostingerStorageSyntheticAdapter.js';\nimport { isCanonicalHostingerStorageControlPlaneRepository } from './hostingerStorageControlPlaneRepository.js';\n\nexport { HOSTINGER_STORAGE_SHARED_CANARY_VERSION };\n",
    'public imports and exports',
  );
  source = replaceOnce(
    source,
    'const SHA256_RE = /^[0-9a-f]{64}$/i;\n',
    'const SHA256_RE = /^[0-9a-f]{64}$/i;\nconst sharedCanaryAuthorityStores = new WeakSet();\nconst sharedCanaryEnablementRegistries = new WeakSet();\n',
    'Shared WeakSets',
  );

  const helperBlock = `function isCanonicalSharedCanaryAuthorityStore(store) {
  return Boolean(
    store
    && sharedCanaryAuthorityStores.has(store)
    && Object.isFrozen(store)
    && store.synthetic_only === true
    && store.production_ready === false
    && typeof store.readImpact === 'function'
    && typeof store.readApproval === 'function'
    && typeof store.readLayout === 'function'
    && typeof store.readReserve === 'function'
    && typeof store.readQuorum === 'function'
  );
}

function isCanonicalSharedCanaryEnablementRegistry(registry) {
  return Boolean(
    registry
    && sharedCanaryEnablementRegistries.has(registry)
    && Object.isFrozen(registry)
    && registry.synthetic_only === true
    && registry.production_ready === false
    && typeof registry.read === 'function'
    && typeof registry.consume === 'function'
  );
}

function requireCanonicalRepository(repository) {
  if (!isCanonicalHostingerStorageControlPlaneRepository(repository)) {
    throw fail(409, 'STORAGE_SHARED_CANARY_CONTROL_PLANE_INVALID', 'Shared canary requires the canonical factory-owned in-memory control-plane repository.', { repository_provenance: 'canonical_factory_owned_required' });
  }
}

function requireCanonicalAdapter(adapter) {
  if (!isCanonicalHostingerStorageSyntheticAdapter(adapter)
    || typeof adapter.mutateExact !== 'function'
    || typeof adapter.readbackItem !== 'function'
    || typeof adapter.readMutationReceipt !== 'function') {
    throw fail(409, 'STORAGE_SHARED_CANARY_EXECUTOR_ADAPTER_INVALID', 'Shared canary requires the canonical factory-owned synthetic adapter.', { adapter_provenance: 'canonical_factory_owned_required' });
  }
}

function requireCanonicalAuthorityStore(store) {
  if (!isCanonicalSharedCanaryAuthorityStore(store)) {
    throw fail(409, 'STORAGE_SHARED_CANARY_AUTHORITY_STORE_INVALID', 'Shared canary requires an authority store created by the Shared factory.', { authority_store_provenance: 'shared_factory_owned_required' });
  }
}

function requireCanonicalEnablementRegistry(registry) {
  if (!isCanonicalSharedCanaryEnablementRegistry(registry)) {
    throw fail(409, 'STORAGE_SHARED_CANARY_ENABLEMENT_REGISTRY_INVALID', 'Shared canary requires a one-shot registry created by the Shared factory.', { enablement_registry_provenance: 'shared_factory_owned_required' });
  }
}

`;
  source = replaceOnce(source, 'function governedQuorumBlockers(record, store, authorization, now) {\n', `${helperBlock}function governedQuorumBlockers(record, store, authorization, now) {\n`, 'provenance helper insertion');
  source = replaceFunctionBodyPrefix(
    source,
    'governedQuorumBlockers',
    "  if (!store || store.synthetic_only !== true || store.production_ready !== false || typeof store.readQuorum !== 'function') {\n",
    "  if (!isCanonicalSharedCanaryAuthorityStore(store)) {\n",
    'governed quorum store predicate',
  );

  const factoryStart = source.indexOf('export function createMemoryHostingerStorageSharedCanaryAuthorityStore() {');
  const preflightStart = source.indexOf('function preflightPlanStatus(', factoryStart);
  if (factoryStart < 0 || preflightStart < 0) throw new Error('Shared authority factory boundary not found');
  let factory = source.slice(factoryStart, preflightStart);
  factory = replaceOnce(factory, '  return Object.freeze({\n', '  const store = Object.freeze({\n', 'authority store object');
  const factoryClose = '  });\n}\n\n';
  if (!factory.endsWith(factoryClose)) throw new Error('Unexpected Shared authority factory closure');
  factory = `${factory.slice(0, -factoryClose.length)}  });\n  sharedCanaryAuthorityStores.add(store);\n  return store;\n}\n\nexport function createMemoryHostingerStorageSharedCanaryEnablementRegistry() {\n  const registry = createCoreEnablementRegistry();\n  sharedCanaryEnablementRegistries.add(registry);\n  return registry;\n}\n\n`;
  source = `${source.slice(0, factoryStart)}${factory}${source.slice(preflightStart)}`;
  source = replaceFunctionBodyPrefix(
    source,
    'preflightPlanStatus',
    "  if (!repository || typeof repository.readAggregate !== 'function') throw fail(409, 'STORAGE_SHARED_CANARY_CONTROL_PLANE_INVALID', 'The governed control-plane repository is required.');\n",
    '  requireCanonicalRepository(repository);\n',
    'preflight canonical repository',
  );
  source = replaceOnce(
    source,
    "  if (!verification.valid) throw fail(409, 'STORAGE_SHARED_CANARY_AUTHORIZATION_INVALID', 'Shared canary authorization is stale or blocked.', { blockers: verification.blockers });\n  if (authorization?.quorum_policy?.mode === 'approved_quorum') {\n",
    "  if (!verification.valid) throw fail(409, 'STORAGE_SHARED_CANARY_AUTHORIZATION_INVALID', 'Shared canary authorization is stale or blocked.', { blockers: verification.blockers });\n  requireCanonicalRepository(input.repository);\n  requireCanonicalAdapter(input.adapter);\n  requireCanonicalAuthorityStore(input.authority_store);\n  requireCanonicalEnablementRegistry(input.enablement_registry);\n  if (authorization?.quorum_policy?.mode === 'approved_quorum') {\n",
    'execute provenance ordering',
  );
  write(path, source);
}

function patchSharedTest() {
  const path = 'http-generic-api/test-hostinger-storage-shared-canary.mjs';
  let source = read(path);
  source = replaceOnce(
    source,
    "} from './hostingerStorageSharedCanary.js';\nimport { createSyntheticExecutorFixture, digest, h } from './test-hostinger-storage-executor-fixtures.mjs';\n",
    "} from './hostingerStorageSharedCanary.js';\nimport {\n  createHostingerStorageControlPlaneRepository,\n  createMemoryHostingerStoragePersistenceAdapter,\n} from './hostingerStorageControlPlaneRepository.js';\nimport { createSyntheticExecutorFixture, digest, h } from './test-hostinger-storage-executor-fixtures.mjs';\n",
    'test repository imports',
  );
  const helperStart = source.indexOf('function createAdminRepository(fixture) {');
  const helperEnd = source.indexOf('function protocolItemSetDigest(fixture) {', helperStart);
  if (helperStart < 0 || helperEnd < 0) throw new Error('Shared repository test helper boundary not found');
  const helperReplacement = `function createRepositoryFromSnapshot(snapshot) {
  const persistence = createMemoryHostingerStoragePersistenceAdapter({ snapshot });
  return createHostingerStorageControlPlaneRepository({ adapter: persistence });
}

function createAdminRepository(fixture) {
  const snapshot = structuredClone(fixture.repository.exportSnapshot());
  const operation = snapshot.state.operations[fixture.operation_id];
  if (!operation) throw new Error('Shared test operation missing from snapshot.');
  delete operation.record_digest;
  operation.context_mode = 'admin';
  operation.record_digest = digest(operation);
  snapshot.state_digest = digest(snapshot.state);
  return createRepositoryFromSnapshot(snapshot);
}

function createPlanStatusRepository(repository, status) {
  const snapshot = structuredClone(repository.exportSnapshot());
  for (const plan of Object.values(snapshot.state.plans || {})) {
    delete plan.record_digest;
    plan.status = status;
    plan.record_digest = digest(plan);
  }
  snapshot.state_digest = digest(snapshot.state);
  return createRepositoryFromSnapshot(snapshot);
}

`;
  source = `${source.slice(0, helperStart)}${helperReplacement}${source.slice(helperEnd)}`;
  source = replaceRegexOnce(source, /leaseFixture\.repository\.renewLease\(/g, 'lease.repository.renewLease(', 'lease renewal repository');

  const provenanceTests = `function assertUnconsumedAndUnchanged(fixture, registry) {
  assert.equal(registry.exportState()[0].consumed, false);
  assert.equal(fixture.adapter.exportState().items[0].exists, true);
}

const forgedRepositoryFixture = fixtureFor('shared-forged-repository');
const forgedRepositoryPrepared = prepare(forgedRepositoryFixture);
const forgedRepositoryStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const forgedRepositoryRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(forgedRepositoryStore, forgedRepositoryRegistry, forgedRepositoryFixture, forgedRepositoryPrepared);
let forgedRepositoryReadCalled = false;
const genuineRepository = forgedRepositoryPrepared.repository;
const forgedRepository = Object.freeze({
  repository_version: genuineRepository.repository_version,
  adapter_key: genuineRepository.adapter_key,
  production_ready: false,
  readAggregate(...args) { forgedRepositoryReadCalled = true; return genuineRepository.readAggregate(...args); },
  transitionOperation: (...args) => genuineRepository.transitionOperation(...args),
  consumePlan: (...args) => genuineRepository.consumePlan(...args),
  appendJournalEvent: (...args) => genuineRepository.appendJournalEvent(...args),
  recordReconciliation: (...args) => genuineRepository.recordReconciliation(...args),
});
assert.throws(
  () => execute(forgedRepositoryFixture, forgedRepositoryPrepared, forgedRepositoryStore, forgedRepositoryRegistry, { repository: forgedRepository }),
  (error) => error.code === 'STORAGE_SHARED_CANARY_CONTROL_PLANE_INVALID'
    && error.details?.repository_provenance === 'canonical_factory_owned_required',
);
assert.equal(forgedRepositoryReadCalled, false);
assertUnconsumedAndUnchanged(forgedRepositoryFixture, forgedRepositoryRegistry);

const forgedAdapterFixture = fixtureFor('shared-forged-adapter');
const forgedAdapterPrepared = prepare(forgedAdapterFixture);
const forgedAdapterStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const forgedAdapterRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(forgedAdapterStore, forgedAdapterRegistry, forgedAdapterFixture, forgedAdapterPrepared);
let forgedAdapterCalled = false;
const genuineAdapter = forgedAdapterFixture.adapter;
const forgedAdapter = Object.freeze({
  ...genuineAdapter,
  mutateExact(...args) { forgedAdapterCalled = true; return genuineAdapter.mutateExact(...args); },
  readbackItem(...args) { forgedAdapterCalled = true; return genuineAdapter.readbackItem(...args); },
  readMutationReceipt(...args) { forgedAdapterCalled = true; return genuineAdapter.readMutationReceipt(...args); },
});
assert.throws(
  () => execute(forgedAdapterFixture, forgedAdapterPrepared, forgedAdapterStore, forgedAdapterRegistry, { adapter: forgedAdapter }),
  (error) => error.code === 'STORAGE_SHARED_CANARY_EXECUTOR_ADAPTER_INVALID'
    && error.details?.adapter_provenance === 'canonical_factory_owned_required',
);
assert.equal(forgedAdapterCalled, false);
assertUnconsumedAndUnchanged(forgedAdapterFixture, forgedAdapterRegistry);

const forgedStoreFixture = fixtureFor('shared-forged-store');
const forgedStorePrepared = prepare(forgedStoreFixture);
const genuineStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const forgedStoreRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(genuineStore, forgedStoreRegistry, forgedStoreFixture, forgedStorePrepared);
let forgedStoreReadCalled = false;
const forgedStore = Object.freeze({
  ...genuineStore,
  readImpact(...args) { forgedStoreReadCalled = true; return genuineStore.readImpact(...args); },
  readApproval(...args) { forgedStoreReadCalled = true; return genuineStore.readApproval(...args); },
  readLayout(...args) { forgedStoreReadCalled = true; return genuineStore.readLayout(...args); },
  readReserve(...args) { forgedStoreReadCalled = true; return genuineStore.readReserve(...args); },
  readQuorum(...args) { forgedStoreReadCalled = true; return genuineStore.readQuorum(...args); },
});
assert.throws(
  () => execute(forgedStoreFixture, forgedStorePrepared, forgedStore, forgedStoreRegistry),
  (error) => error.code === 'STORAGE_SHARED_CANARY_AUTHORITY_STORE_INVALID'
    && error.details?.authority_store_provenance === 'shared_factory_owned_required',
);
assert.equal(forgedStoreReadCalled, false);
assertUnconsumedAndUnchanged(forgedStoreFixture, forgedStoreRegistry);

const forgedRegistryFixture = fixtureFor('shared-forged-registry');
const forgedRegistryPrepared = prepare(forgedRegistryFixture);
const forgedRegistryStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const genuineRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(forgedRegistryStore, genuineRegistry, forgedRegistryFixture, forgedRegistryPrepared);
let forgedRegistryReadCalled = false;
let forgedRegistryConsumeCalled = false;
const forgedRegistry = Object.freeze({
  ...genuineRegistry,
  read(...args) { forgedRegistryReadCalled = true; return genuineRegistry.read(...args); },
  consume(...args) { forgedRegistryConsumeCalled = true; return genuineRegistry.consume(...args); },
});
assert.throws(
  () => execute(forgedRegistryFixture, forgedRegistryPrepared, forgedRegistryStore, forgedRegistry),
  (error) => error.code === 'STORAGE_SHARED_CANARY_ENABLEMENT_REGISTRY_INVALID'
    && error.details?.enablement_registry_provenance === 'shared_factory_owned_required',
);
assert.equal(forgedRegistryReadCalled, false);
assert.equal(forgedRegistryConsumeCalled, false);
assertUnconsumedAndUnchanged(forgedRegistryFixture, genuineRegistry);

`;
  source = replaceOnce(source, "const unknownFixture = fixtureFor('shared-unknown');\n", `${provenanceTests}const unknownFixture = fixtureFor('shared-unknown');\n`, 'provenance test insertion');
  source = replaceOnce(
    source,
    '  current_authority_revalidated: true,\n',
    '  current_authority_revalidated: true,\n  repository_factory_provenance_required: true,\n  adapter_factory_provenance_required: true,\n  authority_store_factory_provenance_required: true,\n  enablement_registry_factory_provenance_required: true,\n  forged_dependency_callbacks_not_invoked: true,\n',
    'provenance result evidence',
  );
  write(path, source);
}

function patchGuard() {
  const path = '.github/workflows/hostinger-storage-shared-canary-guard.yml';
  let source = read(path);
  const oldTriggers = `on:
  pull_request:
    paths:
      - '.github/workflows/hostinger-storage-shared-canary-guard.yml'
      - 'http-generic-api/hostingerStorageSharedCanary*.js'
      - 'http-generic-api/test-hostinger-storage-shared-canary*.mjs'
      - 'specs/014-governed-hostinger-storage-orchestration/e2e-phases.json'
  push:
    branches:
      - 'gpt/014-hostinger/shared-canary-*'
    paths:
      - '.github/workflows/hostinger-storage-shared-canary-guard.yml'
      - 'http-generic-api/hostingerStorageSharedCanary*.js'
      - 'http-generic-api/test-hostinger-storage-shared-canary*.mjs'
      - 'specs/014-governed-hostinger-storage-orchestration/e2e-phases.json'
`;
  const newTriggers = `on:
  pull_request:
    paths:
      - '**/*.js'
      - '**/*.mjs'
      - '**/*.cjs'
      - '**/*.ts'
      - '**/*.tsx'
      - '**/*.mts'
      - '**/*.cts'
      - '.github/workflows/hostinger-storage-shared-canary-guard.yml'
      - 'specs/014-governed-hostinger-storage-orchestration/**'
  push:
    branches:
      - 'gpt/014-hostinger/shared-canary-*'
    paths:
      - '**/*.js'
      - '**/*.mjs'
      - '**/*.cjs'
      - '**/*.ts'
      - '**/*.tsx'
      - '**/*.mts'
      - '**/*.cts'
      - '.github/workflows/hostinger-storage-shared-canary-guard.yml'
      - 'specs/014-governed-hostinger-storage-orchestration/**'
`;
  source = replaceOnce(source, oldTriggers, newTriggers, 'Shared guard triggers');
  source = replaceOnce(
    source,
    "      - name: Check syntax\n",
    "      - name: Install deterministic import parser\n        run: npm ci --ignore-scripts --no-audit --no-fund\n      - name: Check syntax\n",
    'parser install',
  );
  source = replaceOnce(
    source,
    '          node --check http-generic-api/test-hostinger-storage-shared-canary.mjs\n',
    '          node --check http-generic-api/test-hostinger-storage-shared-canary.mjs\n          node --check http-generic-api/test-hostinger-storage-shared-canary-core-import-boundary.mjs\n',
    'scanner syntax check',
  );
  source = replaceOnce(
    source,
    '      - name: Enforce synthetic Shared boundary\n',
    '      - name: Parse Shared Core import boundary\n        run: node http-generic-api/test-hostinger-storage-shared-canary-core-import-boundary.mjs\n      - name: Enforce synthetic Shared boundary\n',
    'scanner execution',
  );
  source = replaceOnce(
    source,
    '          grep -q "STORAGE_SHARED_CANARY_EXECUTOR_PLAN_INVALID" http-generic-api/hostingerStorageSharedCanary.js\n',
    '          grep -q "STORAGE_SHARED_CANARY_EXECUTOR_PLAN_INVALID" http-generic-api/hostingerStorageSharedCanary.js\n          grep -q "isCanonicalHostingerStorageControlPlaneRepository" http-generic-api/hostingerStorageSharedCanary.js\n          grep -q "isCanonicalHostingerStorageSyntheticAdapter" http-generic-api/hostingerStorageSharedCanary.js\n          grep -q "sharedCanaryAuthorityStores.add(store)" http-generic-api/hostingerStorageSharedCanary.js\n          grep -q "sharedCanaryAuthorityStores.has(store)" http-generic-api/hostingerStorageSharedCanary.js\n          grep -q "sharedCanaryEnablementRegistries.add(registry)" http-generic-api/hostingerStorageSharedCanary.js\n          grep -q "sharedCanaryEnablementRegistries.has(registry)" http-generic-api/hostingerStorageSharedCanary.js\n          grep -q "repository_provenance" http-generic-api/test-hostinger-storage-shared-canary.mjs\n          grep -q "adapter_provenance" http-generic-api/test-hostinger-storage-shared-canary.mjs\n          grep -q "authority_store_provenance" http-generic-api/test-hostinger-storage-shared-canary.mjs\n          grep -q "enablement_registry_provenance" http-generic-api/test-hostinger-storage-shared-canary.mjs\n',
    'provenance guard assertions',
  );
  source = replaceOnce(
    source,
    "          const quorumRead = wrapper.indexOf('store.readQuorum(record.policy_id)');\n          const planStatus = wrapper.indexOf('preflightPlanStatus({ authorization, repository: input.repository });');\n          const coreDispatch = wrapper.indexOf('return executeCoreCanary(input);');\n",
    "          const repositoryBrand = wrapper.indexOf('requireCanonicalRepository(input.repository);');\n          const adapterBrand = wrapper.indexOf('requireCanonicalAdapter(input.adapter);');\n          const storeBrand = wrapper.indexOf('requireCanonicalAuthorityStore(input.authority_store);');\n          const registryBrand = wrapper.indexOf('requireCanonicalEnablementRegistry(input.enablement_registry);');\n          const quorumRead = wrapper.indexOf('store.readQuorum(record.policy_id)');\n          const planStatus = wrapper.indexOf('preflightPlanStatus({ authorization, repository: input.repository });');\n          const coreDispatch = wrapper.indexOf('return executeCoreCanary(input);');\n",
    'order variables',
  );
  source = replaceOnce(
    source,
    "          if (!(quorumRead >= 0 && planStatus > quorumRead && coreDispatch > planStatus)) {\n            throw new Error('Governed quorum and current plan status must be validated before entering the Shared canary core.');\n          }\n",
    "          if (!(repositoryBrand >= 0\n            && adapterBrand > repositoryBrand\n            && storeBrand > adapterBrand\n            && registryBrand > storeBrand\n            && quorumRead > registryBrand\n            && planStatus > quorumRead\n            && coreDispatch > planStatus)) {\n            throw new Error('All factory provenance, quorum, and current plan checks must complete before entering the Shared canary core.');\n          }\n",
    'order assertion',
  );
  write(path, source);
}

function patchContractAndEvidence() {
  const contractPath = 'specs/014-governed-hostinger-storage-orchestration/e2e-phases.json';
  const contract = JSON.parse(read(contractPath));
  const tenant = contract.parallel_work.workstreams.find((row) => row.id === 'tenant-canary');
  const shared = contract.parallel_work.workstreams.find((row) => row.id === 'shared-canary');
  if (!tenant || !shared) throw new Error('Tenant or Shared workstream missing from phase contract');
  tenant.status = 'integrated';
  tenant.commit_evidence = {
    head_sha: '154aedecda92bb2c6374ad4acca785d024934422',
    commits: ['154aedecda92bb2c6374ad4acca785d024934422'],
  };
  shared.status = 'ready_for_integration';
  shared.deliverables = [...new Set([
    ...(shared.deliverables || []),
    'Factory-owned repository, adapter, authority-store, and one-shot registry provenance before any Shared authority read or consumption',
    'TypeScript-AST boundary preventing direct Shared Core imports outside the governed wrapper',
  ])];
  const mvp = contract.phases.find((phase) => phase.id === 'mvp');
  if (!mvp) throw new Error('MVP phase missing from contract');
  mvp.blockers = (mvp.blockers || []).map((value) => {
    if (value.startsWith('The Tenant-exclusive canary')) return 'The Tenant-exclusive canary post-merge hardening is integrated but remains synthetic, one-shot, and not mounted to a runtime route.';
    if (value.startsWith('The Shared/Platform canary')) return 'The Shared/Platform canary post-merge provenance hardening is ready for integration but remains synthetic, one-shot, and not mounted to a runtime route.';
    return value;
  });
  write(contractPath, `${JSON.stringify(contract)}\n`);

  write(
    'specs/014-governed-hostinger-storage-orchestration/evidence/shared-canary-postmerge-hardening-20260801.md',
    `# Shared Canary post-merge hardening\n\nWorkstream: \`shared-canary\`\n\nIntegration base SHA: \`da3f8eeafabc53fc17fc89480175b64d590b960e\`\nTenant dependency reviewed head: \`154aedecda92bb2c6374ad4acca785d024934422\`\n\nThis correction requires factory-owned provenance for the canonical in-memory control-plane repository, synthetic adapter, Shared authority store, and one-shot enablement registry before any authority read, plan preflight, enablement read, or consume operation. Frozen structural copies with identical public fields and methods are rejected without invoking their callbacks.\n\nThe public Shared wrapper is the only allowed importer of Shared Core; a TypeScript-AST repository scanner covers static imports, dynamic imports, CommonJS require, constant-composed paths, new URL, and JavaScript/TypeScript module extensions.\n\nSafety remains synthetic-only, non-production, live-provider-disabled, reserve-release-disabled, and dispatch-disabled. No Hostinger, filesystem, SSH, network, credential, SQL, migration, runtime route, deployment, main, or Production authority is introduced.\n`,
  );
}

patchWrapper();
patchSharedTest();
patchGuard();
patchContractAndEvidence();
console.log(JSON.stringify({ ok: true, builder: 'spec014_shared_postmerge_hardening', secrets_included: false }));
