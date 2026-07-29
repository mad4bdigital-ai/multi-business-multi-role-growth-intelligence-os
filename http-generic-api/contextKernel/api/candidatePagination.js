import {
  ContextApiValidationError,
  freezeApiValue,
  requireInteger,
  requireString,
} from "./apiSupport.js";

function candidateSortKey(candidate) {
  return [
    requireString(candidate?.stableRef, "candidate.stableRef", { maxLength: 512 }),
    typeof candidate?.candidateType === "string" ? candidate.candidateType : "",
    typeof candidate?.displayLabel === "string" ? candidate.displayLabel : "",
  ].join("\u0000");
}

function encodeCursor(sortKey) {
  const payload = JSON.stringify({ version: 1, sortKey });
  return Buffer.from(payload, "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (parsed?.version !== 1 || typeof parsed.sortKey !== "string" || parsed.sortKey === "") {
      throw new Error("invalid cursor payload");
    }
    return parsed.sortKey;
  } catch {
    throw new ContextApiValidationError("candidateCursor is invalid.", [
      { field: "candidateCursor", issue: "invalid or unsupported cursor" },
    ]);
  }
}

export function paginateCandidates(candidates, { limit = 25, cursor = null } = {}) {
  const pageLimit = requireInteger(limit, "candidateLimit", { min: 1, max: 100 });
  const sorted = [...(Array.isArray(candidates) ? candidates : [])].sort((left, right) => (
    candidateSortKey(left).localeCompare(candidateSortKey(right))
  ));
  const cursorKey = decodeCursor(cursor);
  let start = 0;
  if (cursorKey) {
    const index = sorted.findIndex((candidate) => candidateSortKey(candidate) === cursorKey);
    if (index < 0) {
      throw new ContextApiValidationError("candidateCursor is stale or outside the authorized candidate set.", [
        { field: "candidateCursor", issue: "cursor does not reference the current authorized candidate set" },
      ]);
    }
    start = index + 1;
  }

  const items = sorted.slice(start, start + pageLimit);
  const hasMore = start + items.length < sorted.length;
  const nextCursor = hasMore && items.length > 0
    ? encodeCursor(candidateSortKey(items.at(-1)))
    : null;

  return freezeApiValue({
    items,
    page: {
      limit: pageLimit,
      hasMore,
      nextCursor,
    },
  });
}

export const _testingCandidatePagination = Object.freeze({
  candidateSortKey,
  decodeCursor,
  encodeCursor,
});
