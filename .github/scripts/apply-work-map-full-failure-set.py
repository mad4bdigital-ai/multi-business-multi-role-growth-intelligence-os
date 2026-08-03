from __future__ import annotations

import json
from pathlib import Path

WORKFLOW_PATH = Path('.github/workflows/spec-kit-work-map-autofix.yml')
TEST_PATH = Path('http-generic-api/test-work-map-autofix-validation-diagnostics.mjs')
E2E_PATH = Path('.changes/e2e/work-map-autofix-validation-diagnostics.json')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def update_workflow() -> None:
    text = WORKFLOW_PATH.read_text(encoding='utf-8')
    start_marker = '      - name: Validate generator and governance contracts\n'
    end_marker = '      - name: Regenerate and prove idempotency\n'
    start = text.index(start_marker)
    end = text.index(end_marker, start)

    validation_block = r'''      - name: Validate generator and governance contracts
        id: validate
        run: |
          set -euo pipefail
          validation_results="${DIAGNOSTIC_ROOT}/validation-results.tsv"
          validation_summary="${DIAGNOSTIC_ROOT}/validation-summary.md"
          failed_contract_file="${DIAGNOSTIC_ROOT}/failed-validation-contract.txt"
          failed_exit_code_file="${DIAGNOSTIC_ROOT}/failed-validation-exit-code.txt"
          failed_contracts_file="${DIAGNOSTIC_ROOT}/failed-validation-contracts.tsv"
          : > "${failed_contracts_file}"

          run_contract() {
            local contract_name="$1"
            shift
            local log_file="${DIAGNOSTIC_ROOT}/validation-${contract_name}.log"

            echo "::group::${contract_name}"
            set +e
            "$@" >"${log_file}" 2>&1
            local exit_code=$?
            set -e
            cat "${log_file}"
            echo "::endgroup::"

            if [[ "${exit_code}" -ne 0 ]]; then
              printf '%s\tfailed\t%s\n' "${contract_name}" "${exit_code}" >> "${validation_results}"
              printf '%s\t%s\n' "${contract_name}" "${exit_code}" >> "${failed_contracts_file}"
              if [[ ! -s "${failed_contract_file}" ]]; then
                printf '%s\n' "${contract_name}" > "${failed_contract_file}"
                printf '%s\n' "${exit_code}" > "${failed_exit_code_file}"
              fi
              return 0
            fi

            printf '%s\tpassed\t0\n' "${contract_name}" >> "${validation_results}"
          }

          run_contract "syntax-platform-work-map-generator" \
            node --check http-generic-api/scripts/platform-work-map-generator.mjs
          run_contract "syntax-platform-work-map-schema-intelligence" \
            node --check http-generic-api/scripts/platform-work-map-schema-intelligence.mjs
          run_contract "syntax-work-map-schema-classification" \
            node --check http-generic-api/scripts/work-map-schema-classification.mjs
          run_contract "syntax-work-map-schema-classification-contract" \
            node --check http-generic-api/scripts/work-map-schema-classification-contract.mjs
          run_contract "syntax-pipeline-connectivity-check" \
            node --check http-generic-api/scripts/pipeline-connectivity-check.mjs
          run_contract "pipeline-connectivity-check" \
            node http-generic-api/scripts/pipeline-connectivity-check.mjs
          run_contract "pipeline-connectivity-regression" \
            node http-generic-api/test-pipeline-connectivity-check.mjs
          run_contract "schema-classification-contract" \
            node http-generic-api/scripts/work-map-schema-classification-contract.mjs
          run_contract "schema-classification" \
            node http-generic-api/scripts/work-map-schema-classification.mjs
          run_contract "schema-classification-regression" \
            node http-generic-api/test-work-map-schema-classification.mjs
          run_contract "schema-classification-contract-regression" \
            node http-generic-api/test-work-map-schema-classification-contract.mjs

          {
            echo "## Validation outcomes"
            echo
            echo "| Contract | Outcome | Exit code | Log |"
            echo "|---|---|---:|---|"
            while IFS=$'\t' read -r contract outcome exit_code; do
              printf '| `%s` | `%s` | `%s` | `validation-%s.log` |\n' \
                "${contract}" "${outcome}" "${exit_code}" "${contract}"
            done < "${validation_results}"
          } > "${validation_summary}"
          cat "${validation_summary}"

          failed_count="$(awk -F '\t' '$2 == "failed" { count += 1 } END { print count + 0 }' "${validation_results}")"
          if [[ "${failed_count}" -ne 0 ]]; then
            {
              echo
              echo "## Validation failure set"
              echo
              echo "All validation contracts were evaluated before this fail-closed gate stopped generation."
              echo
              echo "| Contract | Exit code |"
              echo "|---|---:|"
              while IFS=$'\t' read -r contract exit_code; do
                printf '| `%s` | `%s` |\n' "${contract}" "${exit_code}"
              done < "${failed_contracts_file}"
              echo
              echo "Failed contract count: \`${failed_count}\`"
            } >> "${DIAGNOSTIC_ROOT}/report.md"
            exit 1
          fi

'''

    text = text[:start] + validation_block + text[end:]

    text = replace_once(
        text,
        '          failed_validation_contract="none"\n          failed_validation_exit_code="none"\n',
        '          failed_validation_contract="none"\n'
        '          failed_validation_exit_code="none"\n'
        '          failed_validation_contracts_count="0"\n'
        '          failed_validation_contracts="none"\n',
        'finalizer defaults',
    )

    existing_reads = '''          if [[ -s "${DIAGNOSTIC_ROOT}/failed-validation-exit-code.txt" ]]; then
            failed_validation_exit_code="$(tr -d '\\r\\n' < "${DIAGNOSTIC_ROOT}/failed-validation-exit-code.txt")"
          fi
'''
    expanded_reads = existing_reads + '''          if [[ -s "${DIAGNOSTIC_ROOT}/failed-validation-contracts.tsv" ]]; then
            failed_validation_contracts_count="$(wc -l < "${DIAGNOSTIC_ROOT}/failed-validation-contracts.tsv" | tr -d '[:space:]')"
            failed_validation_contracts="$(awk -F '\\t' 'BEGIN { first=1 } { if (!first) printf ","; printf "%s:%s", $1, $2; first=0 } END { print "" }' "${DIAGNOSTIC_ROOT}/failed-validation-contracts.tsv" | tr -d '\\r\\n')"
          fi
'''
    text = replace_once(text, existing_reads, expanded_reads, 'failure-set reads')

    text = replace_once(
        text,
        '          | Failed validation exit code | \\`${failed_validation_exit_code}\\` |\n',
        '          | Failed validation exit code | \\`${failed_validation_exit_code}\\` |\n'
        '          | Failed validation contracts count | \\`${failed_validation_contracts_count}\\` |\n'
        '          | Failed validation contracts | \\`${failed_validation_contracts}\\` |\n',
        'markdown failure-set fields',
    )

    text = replace_once(
        text,
        '            --arg failed_validation_exit_code "${failed_validation_exit_code}" \\\n',
        '            --arg failed_validation_exit_code "${failed_validation_exit_code}" \\\n'
        '            --arg failed_validation_contracts_count "${failed_validation_contracts_count}" \\\n'
        '            --arg failed_validation_contracts "${failed_validation_contracts}" \\\n',
        'jq failure-set args',
    )

    text = replace_once(
        text,
        '            \'{contract:$contract,outcome:$outcome,target_branch:$target_branch,expected_head_sha:$expected_head_sha,failed_validation_contract:$failed_validation_contract,failed_validation_exit_code:$failed_validation_exit_code,result_head_sha:$result_head_sha,changed:$changed,direct_protected_branch_mutation:false,force_push:false,secrets_included:false}\' \\\n',
        '            \'{contract:$contract,outcome:$outcome,target_branch:$target_branch,expected_head_sha:$expected_head_sha,failed_validation_contract:$failed_validation_contract,failed_validation_exit_code:$failed_validation_exit_code,failed_validation_contracts_count:($failed_validation_contracts_count|tonumber),failed_validation_contracts:$failed_validation_contracts,result_head_sha:$result_head_sha,changed:$changed,direct_protected_branch_mutation:false,force_push:false,secrets_included:false}\' \\\n',
        'jq failure-set object',
    )

    text = replace_once(
        text,
        '            body="WORK_MAP_AUTOFIX_V2 outcome=${JOB_STATUS} expected_head_sha=${EXPECTED_HEAD_SHA} failed_validation_contract=${failed_validation_contract} failed_validation_exit_code=${failed_validation_exit_code} result_head_sha=${RESULT_HEAD_SHA:-unresolved} changed=${CHANGED:-unknown} protected_branch_mutation=false force_push=false"\n',
        '            body="WORK_MAP_AUTOFIX_V2 outcome=${JOB_STATUS} expected_head_sha=${EXPECTED_HEAD_SHA} failed_validation_contract=${failed_validation_contract} failed_validation_exit_code=${failed_validation_exit_code} failed_validation_contracts_count=${failed_validation_contracts_count} failed_validation_contracts=${failed_validation_contracts} result_head_sha=${RESULT_HEAD_SHA:-unresolved} changed=${CHANGED:-unknown} protected_branch_mutation=false force_push=false"\n',
        'comment failure-set fields',
    )

    WORKFLOW_PATH.write_text(text, encoding='utf-8')


def update_test() -> None:
    content = r'''#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "spec-kit-work-map-autofix.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");

const initializationStart = workflow.indexOf("      - name: Initialize diagnostics and validate inputs");
const checkoutStart = workflow.indexOf("      - name: Checkout exact authorized head");
const validationStart = workflow.indexOf("      - name: Validate generator and governance contracts");
const generationStart = workflow.indexOf("      - name: Regenerate and prove idempotency");
assert.notEqual(initializationStart, -1, "diagnostic initialization step is missing");
assert.notEqual(checkoutStart, -1, "checkout step is missing");
assert.notEqual(validationStart, -1, "validation step is missing");
assert.notEqual(generationStart, -1, "generation step is missing");
assert.ok(checkoutStart > initializationStart, "checkout must follow input and diagnostic initialization");
assert.ok(validationStart > checkoutStart, "validation must follow checkout");
assert.ok(generationStart > validationStart, "validation step must precede generation");

const initializationBlock = workflow.slice(initializationStart, checkoutStart);
const validationBlock = workflow.slice(validationStart, generationStart);
const contractNames = [
  "syntax-platform-work-map-generator",
  "syntax-platform-work-map-schema-intelligence",
  "syntax-work-map-schema-classification",
  "syntax-work-map-schema-classification-contract",
  "syntax-pipeline-connectivity-check",
  "pipeline-connectivity-check",
  "pipeline-connectivity-regression",
  "schema-classification-contract",
  "schema-classification",
  "schema-classification-regression",
  "schema-classification-contract-regression",
];

assert.match(
  initializationBlock,
  /diagnostic_root="\$\{RUNNER_TEMP\}\/work-map-autofix-diagnostics-\$\{GITHUB_RUN_ID\}"/,
  "diagnostics must live outside GITHUB_WORKSPACE so checkout cannot remove them",
);
assert.doesNotMatch(initializationBlock, /GITHUB_WORKSPACE.*work-map-autofix-diagnostics/);
assert.match(
  workflow,
  /path: \$\{\{ runner\.temp \}\}\/work-map-autofix-diagnostics-\$\{\{ github\.run_id \}\}/,
  "artifact upload must read the checkout-safe diagnostic directory",
);
assert.match(workflow, /if-no-files-found: error/);

assert.match(validationBlock, /run_contract\(\) \{/);
assert.match(validationBlock, /validation-\$\{contract_name\}\.log/);
assert.match(validationBlock, /"\$@" >"\$\{log_file\}" 2>&1/);
assert.match(validationBlock, /cat "\$\{log_file\}"/);
assert.match(validationBlock, /failed-validation-contract\.txt/);
assert.match(validationBlock, /failed-validation-exit-code\.txt/);
assert.match(validationBlock, /failed-validation-contracts\.tsv/);
assert.match(validationBlock, /validation-results\.tsv/);
assert.match(validationBlock, /validation-summary\.md/);
assert.match(validationBlock, /if \[\[ ! -s "\$\{failed_contract_file\}" \]\]; then/);
assert.match(validationBlock, /return 0/);
assert.doesNotMatch(validationBlock, /return "\$\{exit_code\}"/);
assert.match(validationBlock, /failed_count=.*awk/);
assert.match(validationBlock, /All validation contracts were evaluated before this fail-closed gate stopped generation/);
assert.match(validationBlock, /exit 1/);

for (const contractName of contractNames) {
  const escaped = contractName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    validationBlock,
    new RegExp(`run_contract "${escaped}"`),
    `missing named validation contract: ${contractName}`,
  );
}

const invocations = validationBlock.match(/^\s*run_contract "/gm) ?? [];
assert.equal(invocations.length, contractNames.length, "unexpected number of named validation contracts");

assert.match(workflow, /\| Failed validation contract \| \\`\$\{failed_validation_contract\}\\` \|/);
assert.match(workflow, /\| Failed validation exit code \| \\`\$\{failed_validation_exit_code\}\\` \|/);
assert.match(workflow, /\| Failed validation contracts count \| \\`\$\{failed_validation_contracts_count\}\\` \|/);
assert.match(workflow, /\| Failed validation contracts \| \\`\$\{failed_validation_contracts\}\\` \|/);
assert.match(workflow, /--arg failed_validation_contracts_count "\$\{failed_validation_contracts_count\}"/);
assert.match(workflow, /--arg failed_validation_contracts "\$\{failed_validation_contracts\}"/);
assert.match(workflow, /failed_validation_contracts_count:\(\$failed_validation_contracts_count\|tonumber\)/);
assert.match(workflow, /failed_validation_contracts:\$failed_validation_contracts/);
assert.match(workflow, /failed_validation_contracts_count=\$\{failed_validation_contracts_count\}/);
assert.match(workflow, /failed_validation_contracts=\$\{failed_validation_contracts\}/);
assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@v4/);

assert.doesNotMatch(validationBlock, /git push/);
assert.doesNotMatch(validationBlock, /--force/);
assert.doesNotMatch(validationBlock, /platform-work-map-generator\.mjs --write/);

console.log("Work Map Autofix complete failure-set diagnostics regression passed.");
'''
    TEST_PATH.write_text(content, encoding='utf-8')


def update_e2e() -> None:
    payload = json.loads(E2E_PATH.read_text(encoding='utf-8'))
    payload['title'] = 'Work Map Autofix complete validation failure-set diagnostics'
    journey = payload['phases'][0]['e2e_journeys'][0]
    payload['phases'][0]['objective'] = (
        'Evaluate all eleven Work Map Autofix validation contracts, persist each outcome and log, '
        'preserve backward-compatible first-failure fields, and fail closed once the complete failure set is captured.'
    )
    journey['terminal_outcome'] = (
        'Every validation contract is evaluated and represented in checkout-safe evidence; all failing contract names '
        'and exit codes plus the backward-compatible first failure are exposed before generation and repository mutation remain blocked.'
    )
    journey['steps'] = [
        'Load the workflow-dispatch-only Work Map Autofix writer without dispatching it.',
        'Verify diagnostics are initialized under the run-scoped runner temporary directory instead of the checkout workspace.',
        'Verify all eleven generator, connectivity, and classification checks are invoked through the named contract wrapper.',
        'Verify each contract writes a dedicated log and appends its outcome and exit code without stopping later validation contracts.',
        'Verify the aggregate gate preserves the first failure, records the complete failure set and count, and fails closed before generation.',
        'Verify Markdown, JSON, pull-request comment, and artifact evidence expose bounded failure-set diagnostics.',
        'Verify validation contains no generation, push, force-push, protected-branch mutation, or external-send authority.',
    ]
    journey['assertions'] = [
        'All eleven validation commands have stable unique names and dedicated runner-temporary logs.',
        'A non-zero validation command is recorded but does not prevent the remaining validation-only commands from running.',
        'The first failed contract and exit code remain available for backward compatibility.',
        'The complete failed-contract count and contract-to-exit-code set are emitted in bounded evidence.',
        'The workflow fails closed before generation, commit, push, or verification when any validation fails.',
        'Diagnostic files survive checkout cleanup and are uploaded with missing files treated as an error under always().',
        'No new trigger, permission, writer, force-push, protected-branch, database, Production, provider, credential, or external-send authority is added.',
    ]
    E2E_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def main() -> None:
    update_workflow()
    update_test()
    update_e2e()


if __name__ == '__main__':
    main()
