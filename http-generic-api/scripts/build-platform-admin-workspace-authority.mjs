import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const apiRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const descriptorPath=path.join(apiRoot,"config","platform-admin-workspace-authority.json");
const modulePath=path.join(apiRoot,"src","domain","authorityScope","platformAdminWorkspaceAuthority.generated.js");
const seedPath=path.join(apiRoot,"migrations","20260920_platform_admin_workspace_canonical_seed.sql");
const check=process.argv.includes("--check");

function readDescriptor(){
  const value=JSON.parse(fs.readFileSync(descriptorPath,"utf8"));
  if(value.contract!=="mad4b.platform-admin-workspace-authority.v1"||value.source_of_truth!==true)throw new Error("Platform Admin authority descriptor contract is invalid.");
  return value;
}
function renderGenerated(d){
  return "// GENERATED from config/platform-admin-workspace-authority.json. Do not edit by hand.\n"+
    "function deepFreeze(value) {\n  if (value && typeof value === \"object\" && !Object.isFrozen(value)) {\n    Object.freeze(value);\n    for (const child of Object.values(value)) deepFreeze(child);\n  }\n  return value;\n}\n\n"+
    "export const PLATFORM_ADMIN_WORKSPACE_AUTHORITY = deepFreeze("+JSON.stringify(d,null,2)+");\n";
}
function renderSeed(d){
  const i=d.identity;const r=d.resolver;
  return `-- Recreate the canonical Platform Admin workspace during an official schema-only
-- Staging rebuild. Conflicting ID/key rows are intentionally left untouched so
-- the exact semantic readback fails closed instead of rewriting another identity.

INSERT INTO workspace_registry (
  workspace_id, tenant_id, workspace_key, display_name, workspace_type,
  bootstrap_status, config_json
)
SELECT
  '${i.workspace_id}',
  '${i.tenant_id}',
  '${i.seed_workspace_key}',
  '${i.display_name}',
  '${i.workspace_type}',
  '${i.bootstrap_status}',
  JSON_OBJECT('authority_scope_key', '${r.authority_scope_key}', 'platform_admin_workspace', TRUE)
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_registry
  WHERE workspace_id = '${i.workspace_id}'
     OR (tenant_id = '${i.tenant_id}'
         AND workspace_key = '${i.seed_workspace_key}')
);

UPDATE workspace_registry
SET config_json = JSON_SET(
      CASE WHEN JSON_VALID(COALESCE(config_json, '')) THEN config_json ELSE JSON_OBJECT() END,
      '$.authority_scope_key', '${r.authority_scope_key}',
      '$.platform_admin_workspace', TRUE
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE workspace_id = '${i.workspace_id}'
  AND tenant_id = '${i.tenant_id}'
  AND workspace_key = '${i.seed_workspace_key}'
  AND display_name = '${i.display_name}'
  AND workspace_type = '${i.workspace_type}'
  AND bootstrap_status = '${i.bootstrap_status}';
`;
}
const descriptor=readDescriptor();
const outputs=[[modulePath,renderGenerated(descriptor)],[seedPath,renderSeed(descriptor)]];
if(check){
  const drift=outputs.filter(([file,expected])=>!fs.existsSync(file)||fs.readFileSync(file,"utf8")!==expected).map(([file])=>path.relative(apiRoot,file).replaceAll("\\","/"));
  if(drift.length){process.stderr.write(JSON.stringify({ok:false,contract:"mad4b.platform-admin-workspace-authority-generation.v1",drift})+"\n");process.exit(1);}
  process.stdout.write(JSON.stringify({ok:true,contract:"mad4b.platform-admin-workspace-authority-generation.v1",checked:outputs.length})+"\n");
}else{
  for(const [file,content] of outputs){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
  process.stdout.write(JSON.stringify({ok:true,contract:"mad4b.platform-admin-workspace-authority-generation.v1",written:outputs.length})+"\n");
}
