const MIGRATION_FILENAME_PATTERN = /^\d+_[^/]+\.sql$/u;

export function isMigrationFilename(value) {
  return MIGRATION_FILENAME_PATTERN.test(String(value || ""));
}

function compareLexicographic(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function compareMigrationFiles(left, right) {
  const leftName = String(left || "");
  const rightName = String(right || "");
  const leftMatch = leftName.match(/^(\d+)_/u);
  const rightMatch = rightName.match(/^(\d+)_/u);
  if (!leftMatch || !rightMatch) {
    return compareLexicographic(leftName, rightName);
  }
  const leftVersion = BigInt(leftMatch[1]);
  const rightVersion = BigInt(rightMatch[1]);
  if (leftVersion < rightVersion) return -1;
  if (leftVersion > rightVersion) return 1;
  return compareLexicographic(leftName, rightName);
}
