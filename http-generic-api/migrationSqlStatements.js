function stripSqlComments(sql = "") {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "");
}

const boundaryStart = new RegExp(
  "^(?:CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:TEMPORARY\\s+)?(?:TABLE|VIEW)|CREATE\\s+(?:OR\\s+REPLACE\\s+)?TRIGGER|CREATE\\s+(?:UNIQUE\\s+)?INDEX|INSERT\\s+(?:IGNORE\\s+)?INTO|UPDATE\\s+`?[A-Za-z0-9_]+`?|ALTER\\s+TABLE|SET\\s+@?[A-Za-z0-9_]+|PREPARE\\s+[A-Za-z0-9_]+|EXECUTE\\s+[A-Za-z0-9_]+|DEALLOCATE\\s+PREPARE\\s+[A-Za-z0-9_]+|DROP\\s+(?:TEMPORARY\\s+)?TABLE|TRUNCATE\\s+TABLE|DELETE\\s+FROM|SELECT)\\b",
  "i",
);

function skipInterStatementTrivia(sql, startIndex) {
  let index = startIndex;
  while (index < sql.length) {
    if (/\s/.test(sql[index])) {
      index += 1;
      continue;
    }

    if (sql[index] === "-" && sql[index + 1] === "-") {
      const newline = sql.indexOf("\n", index + 2);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }

    if (sql[index] === "/" && sql[index + 1] === "*") {
      const closing = sql.indexOf("*/", index + 2);
      index = closing === -1 ? sql.length : closing + 2;
      continue;
    }

    break;
  }
  return index;
}

function isBackslashEscaped(sql, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && sql[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/**
 * Canonical statement splitter for governed migration inspection, preflight,
 * authorization, execution, reconciliation, and readback.
 *
 * It recognizes the repository's supported top-level migration statements
 * while lexically protecting quoted SQL strings, identifiers, and comments.
 * This prevents semicolons inside JSON/text literals from becoming boundaries.
 */
export function splitMigrationSqlStatements(sql = "") {
  const source = String(sql || "");
  const statements = [];
  let statementStart = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (character === quote) {
        if (nextCharacter === quote) {
          index += 1;
          continue;
        }
        if (!isBackslashEscaped(source, index)) quote = null;
      }
      continue;
    }

    if (character === "-" && nextCharacter === "-") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }

    if (character !== ";") continue;

    const nextStatementStart = skipInterStatementTrivia(source, index + 1);
    const remainder = source.slice(nextStatementStart);
    if (nextStatementStart < source.length && !boundaryStart.test(remainder)) continue;

    const statement = source.slice(statementStart, index).trim();
    if (stripSqlComments(statement).trim().length > 0) statements.push(statement);
    statementStart = nextStatementStart;
    index = nextStatementStart - 1;
  }

  const trailingStatement = source.slice(statementStart).trim();
  if (stripSqlComments(trailingStatement).trim().length > 0) statements.push(trailingStatement);
  return statements;
}
