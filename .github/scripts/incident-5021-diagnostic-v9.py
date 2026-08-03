from pathlib import Path
import subprocess
import sys
import textwrap

BUILDER_BRANCH = "gpt/incident-5021/exact-head-approval-guard-builder-20260803"
SOURCE_DIAGNOSTIC = ".github/workflows/incident-5021-exact-head-approval-builder-diagnostic-v6.yml"
REPORT_PATH = "incident-5021-builder-diagnostic-v9.json"


def extract_v6_source() -> str:
    raw = subprocess.check_output(
        ["git", "show", f"origin/{BUILDER_BRANCH}:{SOURCE_DIAGNOSTIC}"],
        text=True,
        stderr=subprocess.STDOUT,
    )
    start_marker = "          python - <<'PYDIAG'\n"
    end_marker = "\n          PYDIAG\n"
    start = raw.find(start_marker)
    if start < 0:
        raise RuntimeError("V6 diagnostic start marker missing")
    start += len(start_marker)
    end = raw.find(end_marker, start)
    if end < 0:
        raise RuntimeError("V6 diagnostic end marker missing")
    return textwrap.dedent(raw[start:end])


def add_patch(patches: list[str], label: str, variable: str, code: str) -> None:
    patches.extend([
        f"    {variable}_node = find_labelled_assignment(script, {label!r})",
        f"    {variable}_replacement = {code!r}",
        f"    script = replace_ast_node(script, {variable}_node, {variable}_replacement)",
        "",
    ])


def guarded_replace_code(
    *,
    text_var: str,
    anchor_var: str,
    value_var: str,
    anchor: str,
    value: str,
    error_label: str,
) -> str:
    return "\n".join([
        f"{anchor_var} = {anchor!r}",
        f"{value_var} = {value!r}",
        f"if {text_var}.count({anchor_var}) != 1:",
        f"    raise SystemExit(f\"{error_label}: expected one match, found {{{text_var}.count({anchor_var})}}\")",
        f"{text_var} = {text_var}.replace({anchor_var}, {value_var}, 1)",
        "",
    ])


def build_driver_source() -> str:
    source = extract_v6_source()
    marker = '    script = replace_ast_node(script, success_node, success_replacement)\n'
    if source.count(marker) != 1:
        raise RuntimeError(f"V6 success injection marker mismatch: {source.count(marker)}")

    patches: list[str] = []

    enforcement_anchor = '  if (!renewalAllowed(input)) {\n    throw lifecycleError(\n'
    enforcement_value = '''  if (protectedFinalizationRequiresExplicitEnvelope(operationKey, input)) {
    throw lifecycleError(
      409,
      "OPERATION_CAPABILITY_ENVELOPE_REQUIRED",
      "Protected pull-request finalization requires a separately issued capability envelope; automatic renewal is disabled.",
      {
        operation_key: operationKey,
        previous_envelope_id: existingEnvelopeId || null,
        automatic_renewal_enabled: false,
        next_action: "supply_explicit_approved_capability_envelope",
        secrets_included: false,
      },
    );
  }

  if (!renewalAllowed(input)) {
    throw lifecycleError(
'''
    add_patch(
        patches,
        "explicit envelope enforcement",
        "enforcement",
        guarded_replace_code(
            text_var="capability",
            anchor_var="enforcement_anchor",
            value_var="enforcement_value",
            anchor=enforcement_anchor,
            value=enforcement_value,
            error_label="explicit enforcement anchor",
        ),
    )

    testing_export_anchor = '  renewalProfile,\n  renewalAllowed,\n  publicFailure,\n};\n'
    testing_export_value = '  renewalProfile,\n  renewalAllowed,\n  protectedFinalizationRequiresExplicitEnvelope,\n  publicFailure,\n};\n'
    add_patch(
        patches,
        "testing export",
        "testing_export",
        guarded_replace_code(
            text_var="capability",
            anchor_var="testing_export_anchor",
            value_var="testing_export_value",
            anchor=testing_export_anchor,
            value=testing_export_value,
            error_label="testing export anchor",
        ),
    )

    expired_anchor = '        operation_key: "repo.change.execute",\n        capability_envelope_id: "env-expired",\n'
    expired_value = '        operation_key: "repo.change.execute",\n        automation_key: "branch_cleanup",\n        capability_envelope_id: "env-expired",\n'
    add_patch(
        patches,
        "expired renewal safe recipe",
        "expired",
        guarded_replace_code(
            text_var="capability_test",
            anchor_var="expired_anchor",
            value_var="expired_value",
            anchor=expired_anchor,
            value=expired_value,
            error_label="expired renewal anchor",
        ),
    )

    approval_anchor = '      input: { operation_key: "repo.change.execute", owner: "owner", repo: "repo" },\n      operationKey: "repo.change.execute",\n      createEnvelope: async () => ({\n'
    approval_value = '      input: { operation_key: "repo.change.execute", automation_key: "branch_cleanup", owner: "owner", repo: "repo" },\n      operationKey: "repo.change.execute",\n      createEnvelope: async () => ({\n'
    add_patch(
        patches,
        "approval renewal safe recipe",
        "approval",
        guarded_replace_code(
            text_var="capability_test",
            anchor_var="approval_anchor",
            value_var="approval_value",
            anchor=approval_anchor,
            value=approval_value,
            error_label="approval renewal anchor",
        ),
    )

    capability_tests_anchor = '''  assert.equal(
    _testingOperationCapabilityLifecycleService.repositoryResourceUri({
      owner: "owner",
      repo: "repo",
    }),
    "github://owner/repo",
  );
'''
    capability_tests_addition = capability_tests_anchor + '''  assert.equal(
    _testingOperationCapabilityLifecycleService.protectedFinalizationRequiresExplicitEnvelope(
      "repo.change.execute",
      {},
    ),
    true,
  );
  assert.equal(
    _testingOperationCapabilityLifecycleService.protectedFinalizationRequiresExplicitEnvelope(
      "repo.change.execute",
      { automation_key: "branch_cleanup" },
    ),
    false,
  );
  assert.equal(
    _testingOperationCapabilityLifecycleService.protectedFinalizationRequiresExplicitEnvelope(
      "operation.resume",
      {},
    ),
    true,
  );

  {
    let createCalls = 0;
    await assert.rejects(
      () => prepareOperationCapabilityLifecycle({
        pool: {},
        auth: { tenant_id: "tenant-a", user_id: "user-a" },
        input: { operation_key: "repo.change.execute", owner: "owner", repo: "repo" },
        operationKey: "repo.change.execute",
        createEnvelope: async () => { createCalls += 1; return {}; },
      }),
      (error) => error.code === "OPERATION_CAPABILITY_ENVELOPE_REQUIRED"
        && error.details?.automatic_renewal_enabled === false,
    );
    assert.equal(createCalls, 0);
  }
'''
    add_patch(
        patches,
        "capability explicit envelope tests",
        "capability_tests",
        guarded_replace_code(
            text_var="capability_test",
            anchor_var="capability_tests_anchor",
            value_var="capability_tests_addition",
            anchor=capability_tests_anchor,
            value=capability_tests_addition,
            error_label="capability test insertion anchor",
        ),
    )

    openapi_assertion_anchor = '  assert.match(lifecycleOpenApi, /OPERATION_CAPABILITY_RENEWAL_REQUIRES_APPROVAL/);\n'
    openapi_assertion_value = openapi_assertion_anchor + '  assert.match(lifecycleOpenApi, /OPERATION_CAPABILITY_ENVELOPE_REQUIRED/);\n'
    add_patch(
        patches,
        "OpenAPI explicit envelope assertion",
        "openapi_assertion",
        guarded_replace_code(
            text_var="capability_test",
            anchor_var="openapi_assertion_anchor",
            value_var="openapi_assertion_value",
            anchor=openapi_assertion_anchor,
            value=openapi_assertion_value,
            error_label="OpenAPI assertion anchor",
        ),
    )

    description_anchor = '    envelope. Missing or expired envelopes may be recreated from a governed\n    dry-run, but approval is never granted automatically.\n'
    description_value = '    envelope. Missing or expired envelopes may be recreated from a governed\n    dry-run for lower-risk recipes, but protected pull-request finalization and\n    operation resume require a separately issued explicit envelope.\n'
    add_patch(
        patches,
        "OpenAPI lifecycle description",
        "lifecycle_description",
        guarded_replace_code(
            text_var="openapi",
            anchor_var="description_anchor",
            value_var="description_value",
            anchor=description_anchor,
            value=description_value,
            error_label="OpenAPI lifecycle description anchor",
        ),
    )

    renewal_description_anchor = '            Allows creation of a fresh dry-run envelope when none exists or the\n            supplied envelope expired. It never grants approval automatically.\n'
    renewal_description_value = '            Allows creation of a fresh dry-run envelope when none exists or the\n            supplied envelope expired for lower-risk recipes. It is ignored for protected\n            pull-request finalization and operation resume, which require an explicit envelope.\n'
    add_patch(
        patches,
        "OpenAPI renewal field description",
        "renewal_description",
        guarded_replace_code(
            text_var="openapi",
            anchor_var="renewal_description_anchor",
            value_var="renewal_description_value",
            anchor=renewal_description_anchor,
            value=renewal_description_value,
            error_label="OpenAPI renewal description anchor",
        ),
    )

    error_enum_anchor = '                - OPERATION_CAPABILITY_ENVELOPE_REJECTED\n'
    error_enum_value = error_enum_anchor + '                - OPERATION_CAPABILITY_ENVELOPE_REQUIRED\n'
    add_patch(
        patches,
        "OpenAPI error enum",
        "error_enum",
        guarded_replace_code(
            text_var="openapi",
            anchor_var="error_enum_anchor",
            value_var="error_enum_value",
            anchor=error_enum_anchor,
            value=error_enum_value,
            error_label="OpenAPI error enum anchor",
        ),
    )

    injection = "\n" + "\n".join(patches)
    source = source.replace(marker, marker + injection, 1)
    source = source.replace(
        "incident-5021-builder-diagnostic-v6.json",
        REPORT_PATH,
    )
    source = source.replace(
        "incident_5021_exact_head_approval_builder_v6",
        "incident_5021_exact_head_approval_builder_v9",
    )
    source = source.replace(
        "incident-5021-builder-diagnostic-v6.py",
        "incident-5021-builder-diagnostic-v9.py",
    )
    return source


def main() -> int:
    source = build_driver_source()
    driver_path = Path("/tmp/incident-5021-diagnostic-driver-v9.py")
    compile(source, str(driver_path), "exec")
    driver_path.write_text(source)
    result = subprocess.run(
        [sys.executable, str(driver_path)],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, file=sys.stderr, end="")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
