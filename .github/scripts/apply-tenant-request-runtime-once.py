from pathlib import Path
from textwrap import dedent

workflow = Path(".github/workflows/apply-tenant-request-runtime-once.yml")
text = workflow.read_text(encoding="utf-8")
start_marker = "          python - <<'PY'\n"
end_marker = "\n          PY\n"
start = text.index(start_marker) + len(start_marker)
end = text.index(end_marker, start)
script = dedent(text[start:end])
exec(compile(script, str(workflow), "exec"), {"__name__": "__main__"})
