function unifiedDiffError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

export function applyUnifiedDiffToText(originalText, diffBody) {
  const lines = String(diffBody || "").split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !/^@@/.test(lines[i])) i += 1;
  if (i >= lines.length) {
    throw unifiedDiffError(400, "repo_patch_no_hunks", "unified diff has no hunks (lines starting with @@).");
  }

  const originalLines = String(originalText ?? "").split(/\r?\n/);
  const result = [];
  let originalCursor = 0;

  while (i < lines.length) {
    const header = lines[i];
    const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(header);
    if (!match) {
      i += 1;
      continue;
    }
    const oldStart = Number.parseInt(match[1], 10);
    const oldStartIdx = Math.max(0, oldStart - 1);

    while (originalCursor < oldStartIdx && originalCursor < originalLines.length) {
      result.push(originalLines[originalCursor]);
      originalCursor += 1;
    }

    i += 1;
    while (i < lines.length && !/^@@/.test(lines[i])) {
      const hunkLine = lines[i];
      if (hunkLine.startsWith("---") || hunkLine.startsWith("+++") || hunkLine.startsWith("diff --git") || hunkLine.startsWith("index ")) {
        i += 1;
        continue;
      }
      const prefix = hunkLine[0];
      const body = hunkLine.slice(1);
      if (prefix === " ") {
        if (originalLines[originalCursor] !== body) {
          throw unifiedDiffError(409, "repo_patch_context_mismatch", `unified diff context mismatch at original line ${originalCursor + 1}.`, {
            expected: body,
            found: originalLines[originalCursor],
          });
        }
        result.push(originalLines[originalCursor]);
        originalCursor += 1;
      } else if (prefix === "-") {
        if (originalLines[originalCursor] !== body) {
          throw unifiedDiffError(409, "repo_patch_removal_mismatch", `unified diff removal mismatch at original line ${originalCursor + 1}.`, {
            expected: body,
            found: originalLines[originalCursor],
          });
        }
        originalCursor += 1;
      } else if (prefix === "+") {
        result.push(body);
      } else if (hunkLine === "" || hunkLine === "\\ No newline at end of file") {
        // Tolerate standard diff metadata and a trailing empty line.
      } else {
        // Preserve the existing single-file parser behavior for unknown metadata lines.
      }
      i += 1;
    }
  }

  while (originalCursor < originalLines.length) {
    result.push(originalLines[originalCursor]);
    originalCursor += 1;
  }
  return result.join("\n");
}
