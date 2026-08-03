from pathlib import Path

WORKFLOW = Path(".github/workflows/spec-kit-work-map-autofix.yml")

CHECKS = [
    ("Syntax check platform Work Map generator", "validate_generator_syntax", "platform-work-map-generator-syntax", "validation-01-platform-work-map-generator-syntax.log", "node --check http-generic-api/scripts/platform-work-map-generator.mjs"),
    ("Syntax check Work Map schema intelligence", "validate_schema_intelligence_syntax", "platform-work-map-schema-intelligence-syntax", "validation-02-platform-work-map-schema-intelligence-syntax.log", "node --check http-generic-api/scripts/platform-work-map-schema-intelligence.mjs"),
    ("Syntax check Work Map schema classification", "validate_schema_classification_syntax", "work-map-schema-classification-syntax", "validation-03-work-map-schema-classification-syntax.log", "node --check http-generic-api/scripts/work-map-schema-classification.mjs"),
    ("Syntax check Work Map schema contract", "validate_schema_contract_syntax", "work-map-schema-classification-contract-syntax", "validation-04-work-map-schema-contract-syntax.log", "node --check http-generic-api/scripts/work-map-schema-classification-contract.mjs"),
    ("Syntax check pipeline connectivity validator", "validate_connectivity_syntax", "pipeline-connectivity-check-syntax", "validation-05-pipeline-connectivity-syntax.log", "node --check http-generic-api/scripts/pipeline-connectivity-check.mjs"),
    ("Validate pipeline connectivity graph", "validate_connectivity_graph", "pipeline-connectivity-check", "validation-06-pipeline-connectivity-check.log", "node http-generic-api/scripts/pipeline-connectivity-check.mjs"),
    ("Test pipeline connectivity contract", "test_connectivity_contract", "test-pipeline-connectivity-check", "validation-07-test-pipeline-connectivity-check.log", "node http-generic-api/test-pipeline-connectivity-check.mjs"),
    ("Validate Work Map schema classification contract", "validate_schema_contract", "work-map-schema-classification-contract", "validation-08-work-map-schema-classification-contract.log", "node http-generic-api/scripts/work-map-schema-classification-contract.mjs"),
    ("Validate Work Map schema classification", "validate_schema_classification", "work-map-schema-classification", "validation-09-work-map-schema-classification.log", "node http-generic-api/scripts/work-map-schema-classification.mjs"),
    ("Test Work Map schema classification", "test_schema_classification", "test-work-map-schema-classification", "validation-10-test-work-map-schema-classification.log", "node http-generic-api/test-work-map-schema-classification.mjs"),
    ("Test Work Map schema classification contract", "test_schema_classification_contract", "test-work-map-schema-classification-contract", "validation-11-test-work-map-schema-classification-contract.log", "node http-generic-api/test-work-map-schema-classification-contract.mjs"),
]

STEP_TEMPLATE = """      - name: __DISPLAY__
        id: __ID__
        continue-on-error: true
        run: |
          set -uo pipefail
          log=\"${DIAGNOSTIC_ROOT}/__LOG__\"
          set +e
          __COMMAND__ >\"${log}\" 2>&1
          status=$?
          set -e
          cat \"${log}\"
          printf '%s\\t%s\\t%s\\n' \"__KEY__\" \"${status}\" \"${log##*/}\" >> \"${DIAGNOSTIC_ROOT}/validation-results.tsv\"
          exit \"${status}\"

"""


def render_steps() -> str:
    rendered = []
    for display, step_id, key, log_name, command in CHECKS:
        rendered.append(
            STEP_TEMPLATE.replace("__DISPLAY__", display)
            .replace("__ID__", step_id)
            .replace("__KEY__", key)
            .replace("__LOG__", log_name)
            .replace("__COMMAND__", command)
        )
    return "".join(rendered)


def render_aggregate() -> str:
    env_lines = "\n".join(
        f"          VALIDATE_{index:02d}: ${{{{ steps.{step_id}.outcome }}}}"
        for index, (_, step_id, _, _, _) in enumerate(CHECKS, start=1)
    )
    record_lines = []
    for index, (_, _, key, _, _) in enumerate(CHECKS, start=1):
        suffix = " " + chr(92) if index < len(CHECKS) else ""
        record_lines.append(f'            "{key}=${{VALIDATE_{index:02d}}}"{suffix}')

    return (
        "      - name: Validate generator and governance contracts\n"
        "        id: validate\n"
        "        env:\n"
        f"{env_lines}\n"
        "        run: |\n"
        "          set -euo pipefail\n"
        "          summary=\"${DIAGNOSTIC_ROOT}/validation-summary.md\"\n"
        "          {\n"
        "            echo \"## Validation outcomes\"\n"
        "            echo\n"
        "            echo \"| Check | Outcome |\"\n"
        "            echo \"|---|---|\"\n"
        "          } > \"${summary}\"\n\n"
        "          failed=0\n"
        "          for record in " + chr(92) + "\n"
        + "\n".join(record_lines)
        + "\n          do\n"
        "            check=\"${record%%=*}\"\n"
        "            outcome=\"${record#*=}\"\n"
        "            printf '| `%s` | `%s` |\\n' \"${check}\" \"${outcome}\" >> \"${summary}\"\n"
        "            if [[ \"${outcome}\" != \"success\" ]]; then\n"
        "              failed=1\n"
        "            fi\n"
        "          done\n\n"
        "          if [[ \"${failed}\" != \"0\" ]]; then\n"
        "            awk -F '\\t' '$2 != \"0\" { if (count++) printf \",\"; printf \"%s\", $1 } END { if (count) print \"\" }' " + chr(92) + "\n"
        "              \"${DIAGNOSTIC_ROOT}/validation-results.tsv\" > \"${DIAGNOSTIC_ROOT}/failed-validation-contract.txt\"\n"
        "            awk -F '\\t' '$2 != \"0\" { print $2; exit }' " + chr(92) + "\n"
        "              \"${DIAGNOSTIC_ROOT}/validation-results.tsv\" > \"${DIAGNOSTIC_ROOT}/failed-validation-exit-code.txt\"\n"
        "          fi\n\n"
        "          cat \"${summary}\"\n"
        "          test \"${failed}\" = \"0\"\n\n"
    )


def main() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    start_marker = "      - name: Validate generator and governance contracts\n"
    end_marker = "      - name: Regenerate and prove idempotency\n"
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    text = text[:start] + render_steps() + render_aggregate() + text[end:]

    finalize = text.index("      - name: Finalize diagnostic evidence\n")
    jq_marker = "          jq -n " + chr(92) + "\n"
    jq_index = text.index(jq_marker, finalize)
    summary_insert = (
        "          if [[ -f \"${DIAGNOSTIC_ROOT}/validation-summary.md\" ]]; then\n"
        "            {\n"
        "              echo\n"
        "              cat \"${DIAGNOSTIC_ROOT}/validation-summary.md\"\n"
        "            } >> \"${DIAGNOSTIC_ROOT}/report.md\"\n"
        "          fi\n\n"
    )
    text = text[:jq_index] + summary_insert + text[jq_index:]
    WORKFLOW.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
