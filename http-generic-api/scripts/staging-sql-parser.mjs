export function splitStatements(sql) {
  const statements = [];
  let buffer = "";
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  const flush = () => {
    const statement = buffer
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (statement) statements.push(statement);
    buffer = "";
  };

  for (let index = 0; index < String(sql ?? "").length; index += 1) {
    const current = String(sql ?? "")[index];
    const next = String(sql ?? "")[index + 1] ?? "";

    if (lineComment) {
      buffer += current;
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      buffer += current;
      if (current === "*" && next === "/") {
        buffer += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (!quote && current === "-" && next === "-") {
      buffer += current + next;
      index += 1;
      lineComment = true;
      continue;
    }
    if (!quote && current === "/" && next === "*") {
      buffer += current + next;
      index += 1;
      blockComment = true;
      continue;
    }
    if (quote) {
      buffer += current;
      if (current === "\\") {
        buffer += next;
        index += 1;
      } else if (current === quote) {
        if (next === quote) {
          buffer += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (current === "'" || current === '"' || current === "`") {
      quote = current;
      buffer += current;
      continue;
    }
    if (current === ";") {
      flush();
      continue;
    }
    buffer += current;
  }
  flush();
  return statements;
}
