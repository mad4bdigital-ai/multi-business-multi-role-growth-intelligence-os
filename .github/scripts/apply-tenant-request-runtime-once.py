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
        import re
        matches = list(re.finditer(
            r'const\\s+GOVERNED_RESPONSE_CHUNK_TABLE\\s*=\\s*[\"\\\']governed_tool_response_chunks[\"\\\'];\\r?\\n',
            text,
        ))
        if len(matches) == 1:
            match = matches[0]
            path.write_text(text[:match.start()] + new + text[match.end():], encoding=\"utf-8\")
            print(f\"{label}: applied by semantic anchor\")
            return
""",
    1,
)
exec(compile(script, str(workflow), "exec"), {"__name__": "__main__"})
