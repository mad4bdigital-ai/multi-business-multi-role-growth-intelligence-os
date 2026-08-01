#!/usr/bin/env node
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
  fs.writeFileSync(path, content);
}

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Missing transformation anchor: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Ambiguous transformation anchor: ${label}`);
  return `${source.slice(0, index)}${after}${source.slice(index + before.length)}`;
}

const guardPath = '.github/workflows/hostinger-storage-shared-canary-guard.yml';
let guard = read(guardPath);
const oldOrderBlock = `          const repositoryBrand = wrapper.indexOf('requireCanonicalRepository(repository);');
          const adapterBrand = wrapper.indexOf('requireCanonicalAdapter(adapter);');
          const storeBrand = wrapper.indexOf('requireCanonicalAuthorityStore(authorityStore);');
          const registryBrand = wrapper.indexOf('requireCanonicalEnablementRegistry(enablementRegistry);');
          const quorumRead = wrapper.indexOf('store.readQuorum(record.policy_id)');
          const planStatus = wrapper.indexOf('preflightPlanStatus({ authorization, repository });');
          const capturedInput = wrapper.indexOf('const capturedInput = Object.freeze');
          const coreDispatch = wrapper.indexOf('return executeCoreCanary(capturedInput);');
`;
const newOrderBlock = `          const executeStart = wrapper.indexOf('export function executeHostingerStorageSharedCanary');
          if (executeStart < 0) throw new Error('Shared canary executor was not found.');
          const executeBody = wrapper.slice(executeStart);
          const repositoryBrand = executeBody.indexOf('requireCanonicalRepository(repository);');
          const adapterBrand = executeBody.indexOf('requireCanonicalAdapter(adapter);');
          const storeBrand = executeBody.indexOf('requireCanonicalAuthorityStore(authorityStore);');
          const registryBrand = executeBody.indexOf('requireCanonicalEnablementRegistry(enablementRegistry);');
          const quorumValidation = executeBody.indexOf('governedQuorumBlockers(');
          const planStatus = executeBody.indexOf('preflightPlanStatus({ authorization, repository });');
          const capturedInput = executeBody.indexOf('const capturedInput = Object.freeze');
          const coreDispatch = executeBody.indexOf('return executeCoreCanary(capturedInput);');
`;
guard = replaceOnce(guard, oldOrderBlock, newOrderBlock, 'execute-scoped order indexes');
guard = replaceOnce(
  guard,
  `            && registryBrand > storeBrand
            && quorumRead > registryBrand
            && planStatus > quorumRead
`,
  `            && registryBrand > storeBrand
            && quorumValidation > registryBrand
            && planStatus > quorumValidation
`,
  'execute-scoped quorum ordering',
);
write(guardPath, guard);

const testPath = 'http-generic-api/test-hostinger-storage-shared-canary.mjs';
const testSource = read(testPath);
for (const marker of [
  'repository_provenance',
  'adapter_provenance',
  'authority_store_provenance',
  'enablement_registry_provenance',
  'dependency_getters_captured_once',
]) {
  if (!testSource.includes(marker)) throw new Error(`Shared regression marker missing: ${marker}`);
}

const contractPath = 'specs/014-governed-hostinger-storage-orchestration/e2e-phases.json';
const contract = JSON.parse(read(contractPath));
const tenant = contract.parallel_work?.workstreams?.find((row) => row.id === 'tenant-canary');
const shared = contract.parallel_work?.workstreams?.find((row) => row.id === 'shared-canary');
if (!tenant || !shared) throw new Error('Tenant or Shared workstream missing from phase contract.');

tenant.status = 'integrated';
tenant.commit_evidence = {
  head_sha: '3e99b7ad2a6a89e28b31d6f5569558c16648df22',
  commits: [
    '04c7e7db197a44a26530ed1c8fb923df4e32cf09',
    '9396df473a845c27adedd469e742272a7389588d',
    '3e99b7ad2a6a89e28b31d6f5569558c16648df22',
  ],
};

shared.status = 'ready_for_integration';
shared.deliverables = [...new Set([
  ...(shared.deliverables || []),
  'Factory-owned repository, adapter, authority-store, and one-shot registry provenance before any Shared authority read or consumption',
  'Dependency getters captured exactly once before delegated Shared Core execution',
  'TypeScript-AST boundary preventing direct Shared Core imports outside the governed wrapper',
])];
shared.required_tests = [...(shared.required_tests || []).filter((row) => row.id !== 'hostinger-storage-shared-canary-core-import-boundary'), {
  id: 'hostinger-storage-shared-canary-core-import-boundary',
  runner: 'node',
  working_directory: 'http-generic-api',
  path: 'test-hostinger-storage-shared-canary-core-import-boundary.mjs',
  args: [],
}];
shared.commit_evidence = {
  head_sha: 'fe790e6d7f56876d9317bee16e359b22f1ec2e1e',
  commits: ['fe790e6d7f56876d9317bee16e359b22f1ec2e1e'],
};

const mvp = contract.phases?.find((phase) => phase.id === 'mvp');
if (!mvp) throw new Error('MVP phase missing from contract.');
mvp.blockers = (mvp.blockers || []).map((value) => {
  if (value.startsWith('The Tenant-exclusive canary')) {
    return 'The Tenant-exclusive canary post-merge hardening is integrated but remains synthetic, one-shot, and not mounted to a runtime route.';
  }
  if (value.startsWith('The Shared/Platform canary')) {
    return 'The Shared/Platform canary post-merge provenance hardening is ready for integration but remains synthetic, one-shot, and not mounted to a runtime route.';
  }
  return value;
});
write(contractPath, `${JSON.stringify(contract)}\n`);

write(
  'specs/014-governed-hostinger-storage-orchestration/evidence/shared-canary-postmerge-hardening-20260801.md',
  `# Shared Canary post-merge hardening\n\nWorkstream: \`shared-canary\`\n\nIntegration base SHA: \`e30608bc6be4e5442e1c361a678455fdd2e60951\`\nCandidate lineage head: \`fe790e6d7f56876d9317bee16e359b22f1ec2e1e\`\nTenant dependency head: \`3e99b7ad2a6a89e28b31d6f5569558c16648df22\`\nTenant Integration merge: \`e30608bc6be4e5442e1c361a678455fdd2e60951\`\n\nThis correction requires factory-owned provenance for the canonical in-memory control-plane repository, synthetic adapter, Shared authority store, and one-shot enablement registry before any Shared authority read, plan preflight, enablement read, consume operation, or synthetic mutation. Frozen structural copies with identical public fields and methods are rejected without invoking their callbacks.\n\nDependency getters are captured exactly once before delegation. The public Shared wrapper is the only allowed importer of Shared Core; a TypeScript-AST repository scanner covers static imports, dynamic imports, CommonJS require, constant-composed paths, new URL, and JavaScript/TypeScript module extensions.\n\nSafety remains synthetic-only, non-production, live-provider-disabled, reserve-release-disabled, and dispatch-disabled. No Hostinger, filesystem, SSH, network, credential, SQL, migration, runtime route, deployment, main, or Production authority is introduced.\n`,
);

console.log(JSON.stringify({ ok: true, task: 'finalize_spec014_shared_hardening', secrets_included: false }));
