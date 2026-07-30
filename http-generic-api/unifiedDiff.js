function unifiedDiffError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function parseUnifiedDiffHunks(diffBody) {
  const lines = String(diffBody || "").split(/\r?\n/);
  const hunks = [];
  let index = 0;

  while (index < lines.length) {
    const header = lines[index];
    const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(header);
    if (!match) {
      index += 1;
      continue;
    }

    const hunk = {
      oldStart: Number.parseInt(match[1], 10),
      oldCount: Number.parseInt(match[2] || "1", 10),
      newStart: Number.parseInt(match[3], 10),
      newCount: Number.parseInt(match[4] || "1", 10),
      operations: [],
    };
    index += 1;

    while (index < lines.length && !/^@@/.test(lines[index])) {
      const hunkLine = lines[index];
      if (hunkLine === "\\ No newline at end of file" || hunkLine === "") {
        index += 1;
        continue;
      }
      const prefix = hunkLine[0];
      if (prefix === " " || prefix === "-" || prefix === "+") {
        hunk.operations.push({ prefix, body: hunkLine.slice(1) });
      }
      index += 1;
    }
    hunks.push(hunk);
  }

  if (hunks.length === 0) {
    throw unifiedDiffError(400, "repo_patch_no_hunks", "unified diff has no hunks (lines starting with @@).");
  }
  return hunks;
}

function oldSequenceForHunk(hunk) {
  return hunk.operations
    .filter((operation) => operation.prefix === " " || operation.prefix === "-")
    .map((operation) => operation.body);
}

function sequenceMatchesAt(lines, sequence, startIndex) {
  if (startIndex < 0 || startIndex + sequence.length > lines.length) return false;
  for (let offset = 0; offset < sequence.length; offset += 1) {
    if (lines[startIndex + offset] !== sequence[offset]) return false;
  }
  return true;
}

function exactSequenceMatches(lines, sequence, minimumStart) {
  if (sequence.length === 0) return [];
  const matches = [];
  const firstLine = sequence[0];
  const lastStart = lines.length - sequence.length;
  for (let startIndex = Math.max(0, minimumStart); startIndex <= lastStart; startIndex += 1) {
    if (lines[startIndex] !== firstLine) continue;
    if (sequenceMatchesAt(lines, sequence, startIndex)) matches.push(startIndex);
  }
  return matches;
}

function mismatchAtDeclaredPosition(lines, hunk, declaredIndex) {
  let cursor = declaredIndex;
  for (const operation of hunk.operations) {
    if (operation.prefix !== " " && operation.prefix !== "-") continue;
    if (lines[cursor] !== operation.body) {
      return {
        code: operation.prefix === "-" ? "repo_patch_removal_mismatch" : "repo_patch_context_mismatch",
        expected: operation.body,
        found: lines[cursor],
        line: cursor + 1,
      };
    }
    cursor += 1;
  }
  return {
    code: "repo_patch_context_mismatch",
    expected: null,
    found: null,
    line: declaredIndex + 1,
  };
}

function locateHunk(lines, hunk, originalCursor) {
  const declaredIndex = Math.max(0, hunk.oldStart - 1);
  const oldSequence = oldSequenceForHunk(hunk);

  if (oldSequence.length === 0) {
    if (declaredIndex < originalCursor) {
      throw unifiedDiffError(409, "repo_patch_hunk_overlap", "unified diff insertion overlaps a previously applied hunk.", {
        declared_line: hunk.oldStart,
        minimum_line: originalCursor + 1,
      });
    }
    return Math.min(declaredIndex, lines.length);
  }

  if (declaredIndex >= originalCursor && sequenceMatchesAt(lines, oldSequence, declaredIndex)) {
    return declaredIndex;
  }

  const matches = exactSequenceMatches(lines, oldSequence, originalCursor);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw unifiedDiffError(409, "repo_patch_hunk_ambiguous", "unified diff hunk context matches multiple locations; refusing positional guess.", {
      declared_line: hunk.oldStart,
      candidate_lines: matches.map((match) => match + 1),
      old_line_count: oldSequence.length,
    });
  }

  const mismatch = mismatchAtDeclaredPosition(lines, hunk, declaredIndex);
  throw unifiedDiffError(409, mismatch.code, `unified diff ${mismatch.code === "repo_patch_removal_mismatch" ? "removal" : "context"} mismatch at original line ${mismatch.line}.`, {
    expected: mismatch.expected,
    found: mismatch.found,
    declared_line: hunk.oldStart,
    exact_context_matches: 0,
  });
}

export function applyUnifiedDiffToText(originalText, diffBody) {
  const originalLines = String(originalText ?? "").split(/\r?\n/);
  const hunks = parseUnifiedDiffHunks(diffBody);
  const result = [];
  let originalCursor = 0;

  for (const hunk of hunks) {
    const hunkStart = locateHunk(originalLines, hunk, originalCursor);
    while (originalCursor < hunkStart && originalCursor < originalLines.length) {
      result.push(originalLines[originalCursor]);
      originalCursor += 1;
    }

    for (const operation of hunk.operations) {
      if (operation.prefix === " ") {
        result.push(originalLines[originalCursor]);
        originalCursor += 1;
      } else if (operation.prefix === "-") {
        originalCursor += 1;
      } else if (operation.prefix === "+") {
        result.push(operation.body);
      }
    }
  }

  while (originalCursor < originalLines.length) {
    result.push(originalLines[originalCursor]);
    originalCursor += 1;
  }
  return result.join("\n");
}

export const _testingUnifiedDiff = Object.freeze({
  parseUnifiedDiffHunks,
  oldSequenceForHunk,
  sequenceMatchesAt,
  exactSequenceMatches,
  locateHunk,
});
