from pathlib import Path
from textwrap import dedent

workflow = Path(".github/workflows/apply-tenant-request-runtime-once.yml")
text = workflow.read_text(encoding="utf-8")
start_marker = "          python - <<'PY'\n"
end_marker = "\n          PY\n"
start = text.index(start_marker) + len(start_marker)
end = text.index(end_marker, start)
script = dedent(text[start:end])
script = script.replace(
    "    count = text.count(old)\n",
    """    count = text.count(old)
    if count != 1 and label == \"chunk required columns\":
        matching_lines = [
            line for line in text.splitlines(keepends=True)
            if line.strip().startswith(\"const GOVERNED_RESPONSE_CHUNK_TABLE\")
            and \"governed_tool_response_chunks\" in line
        ]
        if len(matching_lines) == 1:
            path.write_text(text.replace(matching_lines[0], new, 1), encoding=\"utf-8\")
            print(f\"{label}: applied by semantic anchor\")
            return
""",
    1,
)
exec(compile(script, str(workflow), "exec"), {"__name__": "__main__"})
