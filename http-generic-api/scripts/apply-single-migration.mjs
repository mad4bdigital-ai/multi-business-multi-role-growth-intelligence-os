import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createPool } from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, "..");

try {
  const env = readFileSync(resolve(apiRoot, ".env"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch {
  // Rely on process.env in deployed/runtime environments.
}

const migrationFile = process.argv[2];
if (!migrationFile || migrationFile.includes("/") || migrationFile.includes("\\")) {
  console.error("Usage: node scripts/apply-single-migration.mjs <migration-file.sql>");
  process.exit(1);
}

const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"].filter((key) => !process.env[key]);
if (required.length) {
  console.error(`Missing required DB env vars: ${required.join(", ")}`);
  process.exit(1);
}

const pool = createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  multipleStatements: true,
  timezone: "Z",
});

const sql = readFileSync(resolve(apiRoot, "migrations", migrationFile), "utf8");
const statements = sql
  .split(";")
  .map((statement) =>
    statement
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
  )
  .filter(Boolean);

console.log(`Applying ${migrationFile}: ${statements.length} statement(s).`);
for (const statement of statements) {
  const preview = statement.slice(0, 90).replace(/\s+/g, " ");
  await pool.query(statement);
  console.log(`ok: ${preview}...`);
}

await pool.end();
console.log("Done.");
