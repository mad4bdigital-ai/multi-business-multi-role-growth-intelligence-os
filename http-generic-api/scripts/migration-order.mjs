const MIGRATION_FILENAME_PATTERN = /^\d+_[^/]+\.sql$/u;

export function isMigrationFilename(value) {
  return MIGRATION_FILENAME_PATTERN.test(String(value || ""));
}

export function compareMigrationFiles(left, right) {
  const leftName = String(left || "");
  const rightName = String(right || "");
  const leftMatch = leftName.match(/^(\d+)_/u);
  const rightMatch = rightName.match(/^(\d+)_/u);
  if (!leftMatch || !rightMatch) {
    if (!leftMatch && !rightMatch) return leftName.localeCompare(rightName);
    return leftMatch ? -1 : 1;
  }
  const leftVersion = BigInt(leftMatch[1]);
  const rightVersion = BigInt(rightMatch[1]);
  if (leftVersion < rightVersion) return -1;
  if (leftVersion > rightVersion) return 1;
  return leftName.localeCompare(rightName);
}
