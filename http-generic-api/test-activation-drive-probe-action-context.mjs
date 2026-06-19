import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./routes/systemLayerRoutes.js", import.meta.url), "utf8");

assert.match(
  source,
  /import\s+\{\s*getGoogleClients\s*\}\s+from\s+"\.\.\/googleSheets\.js";/,
  "systemLayerRoutes must import the generic governed Google client resolver"
);
assert.match(
  source,
  /async function activationDriveProbe\(\)[\s\S]*?const \{ drive \} = await getGoogleClients\(\{ action_key: "google_drive_api" \}\);/,
  "activationDriveProbe must resolve clients through the explicit google_drive_api action"
);
assert.doesNotMatch(
  source,
  /getGoogleClientsForSpreadsheet\(/,
  "Drive probe code must not acquire Drive through the Sheets-scoped helper"
);
assert.doesNotMatch(
  source,
  /ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID/,
  "Drive probe code must not depend on a spreadsheet identifier"
);

console.log("activation Drive probe action-context contract passed");
