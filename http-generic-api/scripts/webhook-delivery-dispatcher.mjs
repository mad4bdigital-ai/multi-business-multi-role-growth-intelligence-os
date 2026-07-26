#!/usr/bin/env node
import { dispatchPendingWebhookDeliveries } from "../webhookDeliveryDispatcher.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { limit: 25 };
  for (const raw of argv) {
    const match = String(raw || "").match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    args[match[1].replace(/-/g, "_")] = match[2];
  }
  args.limit = Math.min(Math.max(Number.parseInt(args.limit, 10) || 25, 1), 100);
  return args;
}

const args = parseArgs();
try {
  const result = await dispatchPendingWebhookDeliveries({ limit: args.limit });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.failed_count > 0 ? 2 : 0);
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: { code: error.code || "webhook_delivery_dispatch_failed", message: error.message }, secrets_included: false }, null, 2));
  process.exit(1);
}
