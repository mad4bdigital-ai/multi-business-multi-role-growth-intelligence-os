from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Unexpected {label} anchor count: {count}")
    return text.replace(old, new, 1)


parallel_path = Path("http-generic-api/scripts/e2e-parallel-work-governance.mjs")
parallel = parallel_path.read_text()
parallel = replace_once(
    parallel,
    'const SHA_PATTERN = /^[0-9a-f]{40}$/i;\n',
    'const SHA_PATTERN = /^[0-9a-f]{40}$/i;\nconst PARALLEL_OWNERSHIP_NEUTRAL_SPEC_ARTIFACTS = new Set(["work-map-integration.json"]);\n',
    "parallel constant",
)
parallel = replace_once(
    parallel,
    '''function discoverContractPaths(changedFiles, policy) {
  const paths = new Set();
  for (const file of changedFiles) {
    const feature = specKeyFromFile(file, policy);
    if (feature) paths.add(normalize(path.posix.join(policy.spec_root, feature, policy.spec_contract_file)));
    if (file.endsWith(`/${policy.spec_contract_file}`)) paths.add(file);
    if (file.startsWith(`${normalize(policy.non_spec_contract_root)}/`) && file.endsWith(".json")) paths.add(file);
  }
  return [...paths].sort();
}
''',
    '''function isParallelOwnershipNeutralSpecArtifact(file, policy) {
  const feature = specKeyFromFile(file, policy);
  if (!feature) return false;
  const prefix = `${normalize(policy.spec_root)}/${feature}/`;
  const relative = normalize(file).slice(prefix.length);
  return PARALLEL_OWNERSHIP_NEUTRAL_SPEC_ARTIFACTS.has(relative);
}

function discoverContractPaths(changedFiles, policy) {
  const paths = new Set();
  for (const file of changedFiles) {
    const feature = specKeyFromFile(file, policy);
    if (feature && !isParallelOwnershipNeutralSpecArtifact(file, policy)) {
      paths.add(normalize(path.posix.join(policy.spec_root, feature, policy.spec_contract_file)));
    }
    if (file.endsWith(`/${policy.spec_contract_file}`)) paths.add(file);
    if (file.startsWith(`${normalize(policy.non_spec_contract_root)}/`) && file.endsWith(".json")) paths.add(file);
  }
  return [...paths].sort();
}
''',
    "parallel discovery",
)
parallel_path.write_text(parallel)

parallel_test_path = Path("http-generic-api/scripts/e2e-parallel-work-governance-self-test.mjs")
parallel_test = parallel_test_path.read_text()
parallel_insert = r'''
{
  const root = tempRepo();
  const bridgeContract = {
    schema_version: 1,
    feature_key: "generated-binding-bridge",
    title: "Generated binding bridge",
    delivery_mode: "single_pr",
    current_phase: "mvp",
    scope: { include: ["http-generic-api/example/runtime/**"] },
    merge_contract: { minimum_phase: "mvp" },
    phases: [{ id: "mvp", status: "implemented", objective: "Validate a generated binding without parallel ownership." }]
  };
  write(root, ".changes/e2e/generated-binding-bridge.json", `${JSON.stringify(bridgeContract, null, 2)}\n`);
  write(root, "specs/001-example/work-map-integration.json", "{}\n");
  write(root, "http-generic-api/example/runtime/service.mjs");
  const neutral = evaluateParallelWork({
    root,
    policy,
    changedFiles: [
      ".changes/e2e/generated-binding-bridge.json",
      "specs/001-example/work-map-integration.json",
      "http-generic-api/example/runtime/service.mjs"
    ],
    headRef: "gpt/generated-binding-bridge",
    head: "HEAD"
  });
  assert.equal(neutral.ok, true, JSON.stringify(neutral.findings));
  assert.equal(neutral.contracts.length, 0);
}

{
  const root = tempRepo();
  const bridgeContract = {
    schema_version: 1,
    feature_key: "generated-binding-bridge",
    title: "Generated binding bridge",
    delivery_mode: "single_pr",
    current_phase: "mvp",
    scope: { include: ["http-generic-api/example/runtime/**"] },
    merge_contract: { minimum_phase: "mvp" },
    phases: [{ id: "mvp", status: "implemented", objective: "Validate a generated binding without parallel ownership." }]
  };
  write(root, ".changes/e2e/generated-binding-bridge.json", `${JSON.stringify(bridgeContract, null, 2)}\n`);
  write(root, "specs/001-example/e2e-phases.json", `${JSON.stringify(baseContract(), null, 2)}\n`);
  write(root, "specs/001-example/work-map-integration.json", "{}\n");
  write(root, "specs/001-example/spec.md", "# Real Spec change\n");
  write(root, "http-generic-api/example/runtime/service.mjs");
  const realSpec = evaluateParallelWork({
    root,
    policy,
    changedFiles: [
      ".changes/e2e/generated-binding-bridge.json",
      "specs/001-example/work-map-integration.json",
      "specs/001-example/spec.md",
      "http-generic-api/example/runtime/service.mjs"
    ],
    headRef: "gpt/generated-binding-bridge",
    head: "HEAD"
  });
  assert.equal(realSpec.ok, true, JSON.stringify(realSpec.findings));
  assert.equal(realSpec.contracts.length, 1);
  assert.equal(realSpec.contracts[0].feature_key, "001-example");
  assert.equal(realSpec.contracts[0].active_workstream, null);
}

'''
parallel_test = replace_once(
    parallel_test,
    'console.log(JSON.stringify({ ok: true, tests: 7, gate: "e2e_parallel_work_governance", secrets_included: false }));',
    parallel_insert + 'console.log(JSON.stringify({ ok: true, tests: 9, gate: "e2e_parallel_work_governance", secrets_included: false }));',
    "parallel self-test footer",
)
parallel_test_path.write_text(parallel_test)

phase_path = Path("http-generic-api/scripts/e2e-phase-governance.mjs")
phase = phase_path.read_text()
phase = replace_once(
    phase,
    'const MAX_CAPTURE_BUFFER_BYTES = 16 * 1024 * 1024;\n',
    'const MAX_CAPTURE_BUFFER_BYTES = 16 * 1024 * 1024;\nconst E2E_OWNERSHIP_NEUTRAL_SPEC_ARTIFACTS = new Set(["work-map-integration.json"]);\n',
    "phase constant",
)
phase = replace_once(
    phase,
    '''function contractPathForSpec(feature, policy) {
  return normalize(path.posix.join(policy.spec_root, feature, policy.spec_contract_file));
}
''',
    '''function contractPathForSpec(feature, policy) {
  return normalize(path.posix.join(policy.spec_root, feature, policy.spec_contract_file));
}

function isE2EOwnershipNeutralSpecArtifact(file, policy) {
  const feature = specKeyFromFile(file, policy);
  if (!feature) return false;
  const prefix = `${normalize(policy.spec_root)}/${feature}/`;
  const relative = normalize(file).slice(prefix.length);
  return E2E_OWNERSHIP_NEUTRAL_SPEC_ARTIFACTS.has(relative);
}
''',
    "phase helper",
)
phase = replace_once(
    phase,
    '  const changedSpecs = new Set(changedFiles.map((file) => specKeyFromFile(file, policy)).filter(Boolean));\n',
    '  const changedSpecs = new Set(changedFiles.filter((file) => !isE2EOwnershipNeutralSpecArtifact(file, policy)).map((file) => specKeyFromFile(file, policy)).filter(Boolean));\n',
    "phase changed specs",
)
phase_path.write_text(phase)

phase_test_path = Path("http-generic-api/scripts/e2e-phase-governance-self-test.mjs")
phase_test = phase_test_path.read_text()
phase_insert = r'''
{
  const root = tempRepo();
  write(root, "http-generic-api/example/service.mjs");
  write(root, "http-generic-api/example/e2e.mjs", "process.exit(0);\n");
  write(root, "specs/001-example/work-map-integration.json", "{}\n");
  const bridge = contract({
    feature_key: "generated-binding-bridge",
    title: "Generated binding bridge",
    delivery_mode: "single_pr",
    scope: { include: ["http-generic-api/example/**", ".changes/e2e/generated-binding-bridge.json"] }
  });
  write(root, ".changes/e2e/generated-binding-bridge.json", `${JSON.stringify(bridge, null, 2)}\n`);
  const result = evaluateRepository({
    root,
    policy,
    changedFiles: [
      ".changes/e2e/generated-binding-bridge.json",
      "http-generic-api/example/service.mjs",
      "http-generic-api/example/e2e.mjs",
      "specs/001-example/work-map-integration.json"
    ]
  });
  assert.equal(result.report.ok, true, JSON.stringify(result.report.findings));
  assert.deepEqual(result.report.contracts.map((row) => row.contract_path), [".changes/e2e/generated-binding-bridge.json"]);
}

{
  const root = tempRepo();
  write(root, "http-generic-api/example/service.mjs");
  write(root, "http-generic-api/example/e2e.mjs", "process.exit(0);\n");
  write(root, "specs/001-example/work-map-integration.json", "{}\n");
  write(root, "specs/001-example/spec.md", "# Real Spec change\n");
  write(root, "specs/001-example/e2e-phases.json", `${JSON.stringify(contract(), null, 2)}\n`);
  const bridge = contract({
    feature_key: "generated-binding-bridge",
    title: "Generated binding bridge",
    delivery_mode: "single_pr",
    scope: { include: ["http-generic-api/example/**", ".changes/e2e/generated-binding-bridge.json"] }
  });
  write(root, ".changes/e2e/generated-binding-bridge.json", `${JSON.stringify(bridge, null, 2)}\n`);
  const result = evaluateRepository({
    root,
    policy,
    changedFiles: [
      ".changes/e2e/generated-binding-bridge.json",
      "http-generic-api/example/service.mjs",
      "http-generic-api/example/e2e.mjs",
      "specs/001-example/work-map-integration.json",
      "specs/001-example/spec.md"
    ]
  });
  assert.equal(result.report.ok, false);
  assert(result.report.findings.some((row) => row.code === "e2e_phase_contract_not_changed_with_feature"));
}

'''
phase_test = replace_once(
    phase_test,
    'console.log(JSON.stringify({ ok: true, tests: 7, gate: "e2e_phase_governance", secrets_included: false }));',
    phase_insert + 'console.log(JSON.stringify({ ok: true, tests: 9, gate: "e2e_phase_governance", secrets_included: false }));',
    "phase self-test footer",
)
phase_test_path.write_text(phase_test)
