from pathlib import Path

source_path = Path(".tmp/pr3247/patch-source.yml")
source = source_path.read_text(encoding="utf-8").splitlines()
marker = "        run: |"
if source.count(marker) != 1:
    raise SystemExit(f"expected one patch run block, found {source.count(marker)}")

start = source.index(marker) + 1
body: list[str] = []
for line in source[start:]:
    if line and len(line) - len(line.lstrip(" ")) <= 8:
        break
    body.append(line[10:] if line.startswith("          ") else line)

script = "\n".join(body).rstrip() + "\n"
tail_marker = "\ngit config user.name"
if tail_marker not in script:
    raise SystemExit("patch commit tail marker was not found")
script = script.split(tail_marker, 1)[0].rstrip() + "\n"

required_markers = [
    "canAccessGovernedResponseChunk(principal, entry)",
    "cross-tenant memory denial must not extend durable TTL",
]
missing = [item for item in required_markers if item not in script]
if missing:
    raise SystemExit(f"patch integrity markers missing: {missing}")

Path("/tmp/pr3247_patch.sh").write_text(script, encoding="utf-8")
