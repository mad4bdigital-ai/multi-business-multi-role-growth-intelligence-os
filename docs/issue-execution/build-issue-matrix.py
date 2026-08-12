import glob
import json
import re
from pathlib import Path

rows = []
for path in sorted(Path("docs/issue-execution").glob("issue-[0-9]*.json"), key=lambda p: int(re.search(r"issue-(\d+)", p.name).group(1))):
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        continue
    comments = data.get("comments", [])
    comment_text = "\n".join(comment.get("body", "") if isinstance(comment, dict) else str(comment) for comment in comments)
    text = data.get("body", "") + "\n" + comment_text
    refs = sorted(set(re.findall(r"\b(?:PR|Issue)\s*#\d+|\b\d{4}_[a-z0-9_]+\.sql\b|[A-Za-z0-9_./-]+\.(?:js|mjs|json|yaml|yml|md)\b", text, re.I)))
    blockers = []
    for line in text.splitlines():
        low = line.lower()
        if any(key in low for key in ("blocked", "production", "cloudflare", "oauth", "admin", "trigger", "migration", "permission", "external", "runner")):
            clean = line.strip()
            if clean and clean not in blockers:
                blockers.append(clean[:220])
    rows.append({
        "number": data.get("number"),
        "title": data.get("title", ""),
        "labels": [label.get("name", "") if isinstance(label, dict) else str(label) for label in data.get("labels", [])],
        "url": data.get("url", ""),
        "refs": refs[:16],
        "blockers": blockers[:5],
    })
Path("docs/issue-execution/issue-matrix.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")
with Path("docs/issue-execution/issue-matrix.md").open("w") as out:
    out.write("# Expanded Open Issue Execution Matrix\n\n")
    out.write("This matrix is generated from the current open Issue snapshots. It separates repository-local work from external or administrative gates; it does not claim that an Issue is closed.\n\n")
    out.write("| Issue | Title | Labels | References | Execution classification |\n|---:|---|---|---|---|\n")
    for row in rows:
        title = row["title"].replace("|", "\\|")
        refs = "; ".join(row["refs"][:6]).replace("|", "\\|") or "—"
        labels = ", ".join(row["labels"]) or "—"
        text = " ".join(row["blockers"]).lower()
        if any(key in text for key in ("production", "cloudflare", "oauth", "admin", "trigger", "runner", "permission")):
            classification = "local preparation + external gate"
        else:
            classification = "local implementation candidate"
        out.write(f"| [#{row['number']}]({row['url']}) | {title} | {labels} | {refs} | {classification} |\n")
    out.write("\n## Operating rule\n\n")
    out.write("For every external gate, the repository work must still include the local contract, preflight, negative tests, readback parser, evidence schema, and operator runbook. External actions are only considered complete after exact-head evidence and post-action readback are recorded.\n")
