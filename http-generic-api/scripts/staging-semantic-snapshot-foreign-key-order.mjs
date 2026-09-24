export function inspectSemanticSnapshotForeignKeyOrder(tables, foreignKeys) {
  const positions = new Map(tables.map((table, index) => [table, index]));
  const findings = [];
  for (const { child, parent, constraint } of foreignKeys) {
    if (!positions.has(child)) continue;
    if (!positions.has(parent)) {
      findings.push(`${child}.${constraint}: referenced parent ${parent} is absent from semantic snapshot`);
    } else if (child === parent) {
      findings.push(`${child}.${constraint}: self-referencing rows require row-level dependency ordering`);
    } else if (positions.get(parent) > positions.get(child)) {
      findings.push(`${child}.${constraint}: parent ${parent} must precede child ${child}`);
    }
  }
  return findings;
}
