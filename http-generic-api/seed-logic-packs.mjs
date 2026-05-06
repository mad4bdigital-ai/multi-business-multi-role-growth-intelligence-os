/**
 * seed-logic-packs.mjs — Sprint 23
 *
 * Creates canonical logic_packs from existing logic_definitions (grouped by logic_type),
 * builds pack_attachments linking each definition to its pack,
 * and wires agent_logic_pack_bindings for all 16 seeded agents.
 *
 * Safe to re-run — uses INSERT IGNORE throughout.
 *
 * Usage:
 *   node seed-logic-packs.mjs              # execute
 *   node seed-logic-packs.mjs --dry-run    # print plan, no DB writes
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createPool } from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env ─────────────────────────────────────────────────────────────────
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch { /* rely on process.env */ }

const DRY_RUN = process.argv.includes("--dry-run");

const pool = createPool({
  host:     process.env.DB_HOST     || "localhost",
  port:     Number(process.env.DB_PORT || 3306),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl:      process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  multipleStatements: false,
  waitForConnections: true,
  connectionLimit: 3,
});

// ── Canonical packs ───────────────────────────────────────────────────────────
// Each pack_key maps to one or more logic_type values in logic_definitions.

const PACKS = [
  {
    pack_id:      "pck-sop-0000-0001",
    pack_key:     "platform.sop",
    display_name: "Platform Standard Operating Procedures",
    pack_type:    "sop",
    service_mode: "self_serve",
    logic_types:  ["parent"],
  },
  {
    pack_id:      "pck-ops-0000-0001",
    pack_key:     "platform.operational",
    display_name: "Platform Operational Rules",
    pack_type:    "operational",
    service_mode: "self_serve",
    logic_types:  ["execution", "child"],
  },
  {
    pack_id:      "pck-sup-0000-0001",
    pack_key:     "platform.supervision",
    display_name: "Platform Supervision Logic",
    pack_type:    "supervision",
    service_mode: "assisted",
    logic_types:  ["supervisory"],
  },
  {
    pack_id:      "pck-rev-0000-0001",
    pack_key:     "platform.review",
    display_name: "Platform Review Logic",
    pack_type:    "review",
    service_mode: "assisted",
    logic_types:  ["review"],
  },
  {
    pack_id:      "pck-aud-0000-0001",
    pack_key:     "platform.audit",
    display_name: "Platform Audit Logic",
    pack_type:    "audit",
    service_mode: "managed",
    logic_types:  ["audit"],
  },
  {
    pack_id:      "pck-trn-0000-0001",
    pack_key:     "platform.training",
    display_name: "Platform Training Logic",
    pack_type:    "training",
    service_mode: "managed",
    logic_types:  ["training"],
  },
];

// ── Agent → pack bindings ─────────────────────────────────────────────────────
// priority 0 = primary pack for this agent's execution_class

const AGENT_PACK_BINDINGS = [
  // Rule-based agents → operational (primary) rules they evaluate
  { agent_id: "agt-gov-ops-0001", pack_id: "pck-ops-0000-0001", priority: 0 },
  { agent_id: "agt-gov-ops-0001", pack_id: "pck-sop-0000-0001", priority: 1 },

  { agent_id: "agt-sys-gov-0001", pack_id: "pck-sup-0000-0001", priority: 0 },
  { agent_id: "agt-sys-gov-0001", pack_id: "pck-ops-0000-0001", priority: 1 },

  { agent_id: "agt-gov-aud-0001", pack_id: "pck-aud-0000-0001", priority: 0 },
  { agent_id: "agt-gov-aud-0001", pack_id: "pck-ops-0000-0001", priority: 1 },

  // Standard agents → SOP + operational
  { agent_id: "agt-prv-ops-0001", pack_id: "pck-sop-0000-0001", priority: 0 },
  { agent_id: "agt-prv-ops-0001", pack_id: "pck-ops-0000-0001", priority: 1 },

  { agent_id: "agt-exe-000-0001", pack_id: "pck-sop-0000-0001", priority: 0 },
  { agent_id: "agt-exe-000-0001", pack_id: "pck-ops-0000-0001", priority: 1 },

  { agent_id: "agt-cnt-ops-0001", pack_id: "pck-sop-0000-0001", priority: 0 },
  { agent_id: "agt-cnt-ops-0001", pack_id: "pck-ops-0000-0001", priority: 1 },

  { agent_id: "agt-pub-000-0001", pack_id: "pck-sop-0000-0001", priority: 0 },
  { agent_id: "agt-pub-000-0001", pack_id: "pck-ops-0000-0001", priority: 1 },

  { agent_id: "agt-rev-000-0001", pack_id: "pck-sop-0000-0001", priority: 0 },
  { agent_id: "agt-rev-000-0001", pack_id: "pck-ops-0000-0001", priority: 1 },

  { agent_id: "agt-prd-000-0001", pack_id: "pck-sop-0000-0001", priority: 0 },
  { agent_id: "agt-prd-000-0001", pack_id: "pck-ops-0000-0001", priority: 1 },

  { agent_id: "agt-mig-000-0001", pack_id: "pck-sop-0000-0001", priority: 0 },
  { agent_id: "agt-mig-000-0001", pack_id: "pck-ops-0000-0001", priority: 1 },

  // Complex agents → SOP + operational + review
  { agent_id: "agt-seo-000-0001", pack_id: "pck-sop-0000-0001", priority: 0 },
  { agent_id: "agt-seo-000-0001", pack_id: "pck-ops-0000-0001", priority: 1 },
  { agent_id: "agt-seo-000-0001", pack_id: "pck-rev-0000-0001", priority: 2 },

  { agent_id: "agt-mkt-000-0001", pack_id: "pck-sop-0000-0001", priority: 0 },
  { agent_id: "agt-mkt-000-0001", pack_id: "pck-ops-0000-0001", priority: 1 },
  { agent_id: "agt-mkt-000-0001", pack_id: "pck-rev-0000-0001", priority: 2 },

  { agent_id: "agt-grw-000-0001", pack_id: "pck-sop-0000-0001", priority: 0 },
  { agent_id: "agt-grw-000-0001", pack_id: "pck-ops-0000-0001", priority: 1 },
  { agent_id: "agt-grw-000-0001", pack_id: "pck-rev-0000-0001", priority: 2 },

  { agent_id: "agt-brd-000-0001", pack_id: "pck-sop-0000-0001", priority: 0 },
  { agent_id: "agt-brd-000-0001", pack_id: "pck-ops-0000-0001", priority: 1 },
  { agent_id: "agt-brd-000-0001", pack_id: "pck-rev-0000-0001", priority: 2 },

  { agent_id: "agt-air-000-0001", pack_id: "pck-sop-0000-0001", priority: 0 },
  { agent_id: "agt-air-000-0001", pack_id: "pck-ops-0000-0001", priority: 1 },
  { agent_id: "agt-air-000-0001", pack_id: "pck-rev-0000-0001", priority: 2 },

  // Authority agent → all packs
  { agent_id: "agt-sys-int-0001", pack_id: "pck-sop-0000-0001", priority: 0 },
  { agent_id: "agt-sys-int-0001", pack_id: "pck-ops-0000-0001", priority: 1 },
  { agent_id: "agt-sys-int-0001", pack_id: "pck-sup-0000-0001", priority: 2 },
  { agent_id: "agt-sys-int-0001", pack_id: "pck-rev-0000-0001", priority: 3 },
  { agent_id: "agt-sys-int-0001", pack_id: "pck-aud-0000-0001", priority: 4 },
  { agent_id: "agt-sys-int-0001", pack_id: "pck-trn-0000-0001", priority: 5 },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log(DRY_RUN ? "[DRY RUN] seed-logic-packs" : "seed-logic-packs starting...");

  // 1. Count logic_definitions by type
  const [typeCounts] = await pool.query(
    "SELECT logic_type, COUNT(*) AS cnt FROM `logic_definitions` GROUP BY logic_type"
  );
  console.log("\nlogic_definitions by type:");
  for (const r of typeCounts) console.log(`  ${r.logic_type}: ${r.cnt}`);

  const totalDefs = typeCounts.reduce((s, r) => s + Number(r.cnt), 0);
  console.log(`  TOTAL: ${totalDefs}`);

  // 2. Upsert logic_packs
  console.log("\nUpserting logic_packs...");
  for (const p of PACKS) {
    const typeList = p.logic_types.join(", ");
    const count = typeCounts
      .filter(r => p.logic_types.includes(r.logic_type))
      .reduce((s, r) => s + Number(r.cnt), 0);

    console.log(`  [${p.pack_key}] pack_type=${p.pack_type} | covers logic_types: [${typeList}] | ${count} definitions`);

    if (!DRY_RUN) {
      await pool.query(
        `INSERT IGNORE INTO \`logic_packs\`
           (pack_id, pack_key, display_name, pack_type, service_mode, status)
         VALUES (?,?,?,?,?,'active')`,
        [p.pack_id, p.pack_key, p.display_name, p.pack_type, p.service_mode]
      );
      // Activate if already existed as draft
      await pool.query(
        "UPDATE `logic_packs` SET status = 'active' WHERE pack_id = ? AND status = 'draft'",
        [p.pack_id]
      );
    }
  }

  // 3. Create pack_attachments for each logic_definition → its pack
  console.log("\nCreating pack_attachments...");
  let attachTotal = 0;
  for (const p of PACKS) {
    if (!p.logic_types.length) continue;

    const placeholders = p.logic_types.map(() => "?").join(",");
    const [defs] = await pool.query(
      `SELECT logic_id FROM \`logic_definitions\` WHERE logic_type IN (${placeholders})`,
      p.logic_types
    );

    console.log(`  [${p.pack_key}] attaching ${defs.length} definitions`);
    attachTotal += defs.length;

    if (!DRY_RUN) {
      for (const { logic_id } of defs) {
        await pool.query(
          `INSERT IGNORE INTO \`pack_attachments\`
             (attachment_id, pack_id, target_type, target_id)
           VALUES (UUID(),?,?,?)`,
          [p.pack_id, "logic", logic_id]
        );
      }
    }
  }
  console.log(`  TOTAL attachments: ${attachTotal}`);

  // 4. Create agent_logic_pack_bindings
  console.log("\nCreating agent_logic_pack_bindings...");
  for (const b of AGENT_PACK_BINDINGS) {
    if (!DRY_RUN) {
      await pool.query(
        `INSERT IGNORE INTO \`agent_logic_pack_bindings\`
           (agent_id, pack_id, priority)
         VALUES (?,?,?)`,
        [b.agent_id, b.pack_id, b.priority]
      );
    }
  }
  console.log(`  Wrote ${AGENT_PACK_BINDINGS.length} bindings across 16 agents`);

  // 5. Summary
  if (!DRY_RUN) {
    const [packCount]    = await pool.query("SELECT COUNT(*) AS n FROM `logic_packs` WHERE status = 'active'");
    const [attachCount]  = await pool.query("SELECT COUNT(*) AS n FROM `pack_attachments`");
    const [bindingCount] = await pool.query("SELECT COUNT(*) AS n FROM `agent_logic_pack_bindings`");
    console.log("\nFinal state:");
    console.log(`  logic_packs (active):          ${packCount[0].n}`);
    console.log(`  pack_attachments:               ${attachCount[0].n}`);
    console.log(`  agent_logic_pack_bindings:      ${bindingCount[0].n}`);
  }

  await pool.end();
  console.log("\nDone.");
}

run().catch(err => { console.error(err); process.exit(1); });
