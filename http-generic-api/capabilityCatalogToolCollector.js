import {createHash} from "node:crypto";
import {listSystemToolCatalog} from "./systemToolCatalogV2.js";

const ID=/^[a-z0-9][a-z0-9._-]{1,79}$/;
const kindSet=new Set(["connector","skill","external_service","operator"]);
const fail=reason=>{throw Object.assign(new Error(reason),{code:reason})};

export function createCatalogV2SourceCollector({getSubjectEffectiveTools}={}){
 if(typeof getSubjectEffectiveTools!=="function")fail("AUTHORIZED_TOOL_READER_MISSING");
 return async ({site,principal}={})=>{
  if(!site||!ID.test(site.tenant_id??"")||!ID.test(site.site_id??"")||
     !principal)fail("CATALOG_SUBJECT_SCOPE_INVALID");
  const response=await getSubjectEffectiveTools({site,principal});
  if(!response||response.complete!==true||response.authoritative!==true||
     response.site?.site_id!==site.site_id||
     response.site?.tenant_id!==site.tenant_id||
     response.site?.environment!==site.environment||
     response.site?.origin_sha256!==site.origin_sha256||
     response.site?.runtime_generation!==site.runtime_generation||
     !Array.isArray(response.tools))fail("EFFECTIVE_SOURCE_SCOPE_INCOMPLETE");
  if(response.tools.length>32)fail("EFFECTIVE_SOURCE_BUDGET_EXCEEDED");
  for(const tool of response.tools){
   if(!tool||typeof tool.name!=="string"||!tool.source_key||
      !kindSet.has(tool.kind)||tool.connected!==true||
      tool.read_only!==true||tool.effective_read_authorized!==true||
      tool.effect!=="read"||tool.status!=="active"||
      tool.requires_admin===true)
     fail("TOOL_NOT_EFFECTIVELY_READ_AUTHORIZED");
  }
  const snapshot=listSystemToolCatalog(response.tools,{limit:32});
  if(snapshot.page.has_more||snapshot.page.total_count!==response.tools.length)
   fail("CATALOG_SNAPSHOT_NOT_COMPLETE");
  const normalized=new Map(response.tools.map(t=>[t.name,t]));
  const sources=snapshot.items.map(item=>{
   const tool=normalized.get(item.name);
   if(!tool||tool.source_key!==item.source_key)
    fail("CATALOG_SOURCE_METADATA_MISMATCH");
   const digest=createHash("sha256")
    .update(item.source_key+"\0"+item.name,"utf8").digest("hex");
   return {id:"tool-"+digest.slice(0,32),kind:tool.kind,
     ...site,connected:true,read_authorized:true,lane:"read"};
  });
  if(new Set(sources.map(x=>x.id)).size!==sources.length)
   fail("CATALOG_SOURCE_ID_COLLISION");
  return {site:{...site},sources,complete:true,authoritative:true,
    catalog_version:snapshot.catalog_version,snapshot_id:snapshot.snapshot_id};
 };
}
