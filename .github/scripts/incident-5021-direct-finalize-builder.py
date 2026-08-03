from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    path.write_text(text.replace(old, new, 1))


service = Path("http-generic-api/operationCapabilityLifecycleService.js")
replace_once(
    service,
    '''function operationRequiresCapability(operationKey) {
  try {
''',
    '''function operationRequiresCapability(operationKey) {
  if (REPOSITORY_MUTATION_OPERATIONS.has(operationKey)) return true;
  try {
''',
    "repository mutation capability requirement",
)
replace_once(
    service,
    '  if (operationKey === "operation.resume") return true;\n',
    '  if (operationKey === "repo.pr.finalize") return true;\n'
    '  if (operationKey === "operation.resume") return true;\n',
    "direct finalize explicit envelope guard",
)

test = Path("http-generic-api/test-gpt-tools-route-syntax-regression.mjs")
requires_anchor = '''  assert.equal(
    _testingOperationCapabilityLifecycleService.operationRequiresCapability(
      "repo.change.execute",
    ),
    true,
  );
'''
replace_once(
    test,
    requires_anchor,
    requires_anchor + '''  assert.equal(
    _testingOperationCapabilityLifecycleService.operationRequiresCapability(
      "repo.pr.finalize",
    ),
    true,
  );
''',
    "direct finalize capability requirement assertion",
)

helper_anchor = '''  assert.equal(
    _testingOperationCapabilityLifecycleService.protectedFinalizationRequiresExplicitEnvelope(
      "operation.resume",
      {},
    ),
    true,
  );
'''
replace_once(
    test,
    helper_anchor,
    helper_anchor + '''  assert.equal(
    _testingOperationCapabilityLifecycleService.protectedFinalizationRequiresExplicitEnvelope(
      "repo.pr.finalize",
      {},
    ),
    true,
  );
''',
    "direct finalize explicit envelope assertion",
)

lifecycle_anchor = '''    assert.equal(createCalls, 0);
  }

  const renewalRequest = buildCapabilityRenewalRequest({
'''
direct_finalize_case = '''    assert.equal(createCalls, 0);
  }

  {
    let createCalls = 0;
    await assert.rejects(
      () => prepareOperationCapabilityLifecycle({
        pool: {},
        auth: { tenant_id: "tenant-a", user_id: "user-a" },
        input: { operation_key: "repo.pr.finalize", owner: "owner", repo: "repo" },
        operationKey: "repo.pr.finalize",
        createEnvelope: async () => { createCalls += 1; return {}; },
      }),
      (error) => error.code === "OPERATION_CAPABILITY_ENVELOPE_REQUIRED"
        && error.details?.operation_key === "repo.pr.finalize"
        && error.details?.automatic_renewal_enabled === false,
    );
    assert.equal(createCalls, 0);
  }

  const renewalRequest = buildCapabilityRenewalRequest({
'''
replace_once(
    test,
    lifecycle_anchor,
    direct_finalize_case,
    "direct finalize lifecycle rejection",
)

contract = Path(".changes/e2e/repository-lifecycle-draft-merge-guard.json")
replace_once(
    contract,
    '"Require a separately issued capability envelope for pr_delivery, full_workstream, and operation resume instead of just-in-time automatic renewal."',
    '"Require a separately issued capability envelope for direct repo.pr.finalize, pr_delivery, full_workstream, and operation resume instead of just-in-time automatic renewal."',
    "direct finalize e2e journey",
)
