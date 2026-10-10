import {strictParseCsv,guardMatrix,guardContext,guardEditorial,guardReceipt} from './context-source-guard.mjs';
/** Portable offline candidate-ingest + contextual projection + host-attestation boundary.
 * No OAuth, I/O, persistence, external publishing or signature implementation.
 * Receipts require host-injected trusted verification and atomic nonce store.
 */
export function requireScoped(scope) {
  if(!scope||typeof scope!=="object"||typeof scope.tenant_ref!=="string"||!scope.tenant_ref.trim()||typeof scope.brand_ref!=="string"||!scope.brand_ref.trim())throw new Error("SCOPE_REQUIRED");
  return {tenant_ref:scope.tenant_ref,brand_ref:scope.brand_ref,locale:scope.locale||"und"};
}

export function norm(s){
  return String(s??"").normalize("NFKC").toLocaleLowerCase("en").normalize("NFD").replace(/[\u064B-\u065F\u0670]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/[^\p{L}\p{N}]+/gu," ").trim();
}

export function parseCsv(input,options={}){
  return strictParseCsv(input,options);
}


export function asColumns(row){
  const names={title:["content title","content blog article","blog title","title","idea","content idea","عنوان المحتوي"],date:["date","publish date","schedule date","day","التاريخ"],stage:["funnel stage","marketing stage","المرحله"],channel:["channel","platform","القناه"],format:["format","content format","نوع المحتوي"],writer_brief:["writer brief","copy brief"],designer_brief:["designer brief","creative brief"],hook:["hook","الخطاف"],persona:["persona","المستهدف","audience"],status:["status","حاله المنشور"]};
  const normed=row.map(norm),map={};
  for(const [field,aliases] of Object.entries(names)){
    const index=normed.findIndex(x=>aliases.some(a=>norm(a)===x));
    if(index>=0)map[field]=index;
  }
  return map;
}

export function suspiciousValue(value){
  const v=String(value||"");
  return /(?:api[_\s-]?key|password|client[_\s-]?secret|authorization|bearer[_\s]+)[\s:='"]{1,8}[^\s,;"']{4,}/i.test(v) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(v);
}

export function reviewFlags(item,{asOf}={}){
  const flags=[];
  const title=item.title||"";
  if(/^(?:linkedin carousel idea|email campaign idea|explainer video idea|content idea|idea|فكره|فكرة)\s*[#\d]+$/iu.test(title.trim()))flags.push("PLACEHOLDER_TITLE");
  if(/(?:\b\d+(?:[.,]\d+)?\s*%|\bzero downtime\b|\bguaranteed\b|\b\d+x\s+(?:faster|revenue|conversion))/i.test([title,item.hook,item.writer_brief].join(" ")))flags.push("UNVERIFIED_NUMERIC_CLAIM");
  if(/(?:free trial|risk[- ]free|خصم\s*\d+|تجربه مجانيه|تجربة مجانية)/i.test([title,item.hook,item.writer_brief].join(" ")))flags.push("UNVERIFIED_OFFER");
  if(item.date){
    const iso=/^\d{4}-\d{2}-\d{2}$/u.test(item.date);
    if(!iso||!Number.isFinite(Date.parse(item.date+"T00:00:00Z")))flags.push("INVALID_DATE");
    else if(asOf&&Date.parse(item.date+"T23:59:59Z")<Date.parse(asOf+"T00:00:00Z"))flags.push("OUTDATED_DATE");
  }
  if(!title.trim())flags.push("MISSING_TITLE");
  return flags;
}

export function importMatrix({matrix,scope,source,asOf,declaredDays}){
  guardMatrix(matrix);
  const s=requireScoped(scope);
  if(!source||!source.source_key||!source.revision||!Array.isArray(matrix)||!matrix.length)throw new Error("SOURCE_REVISION_AND_ROWS_REQUIRED");
  if(matrix.length>5001)throw new Error("ROW_LIMIT");
  const header=matrix[0].map(x=>String(x??""));
  const columns=asColumns(header);
  if(columns.title===undefined)throw new Error("TITLE_COLUMN_REQUIRED");
  const candidates=[],rejected=[],seen=new Set(),days=new Set();
  for(let i=1;i<matrix.length;i++){
    const row=matrix[i].map(x=>String(x??""));
    if(row.length>64||row.some(x=>x.length>4096)){rejected.push({row_index:i+1,reason:"ROW_LIMIT"});continue;}
    if(row.some(suspiciousValue)){rejected.push({row_index:i+1,reason:"SENSITIVE_VALUE_QUARANTINED"});continue;}
    const get=k=>columns[k]===undefined?"":String(row[columns[k]]??"").trim();
    const item={record_key:`candidate:${i}`,title:get("title"),date:get("date"),stage:get("stage"),format:get("format"),channel:get("channel"),persona:get("persona"),hook:get("hook"),writer_brief:get("writer_brief"),designer_brief:get("designer_brief"),status:"CANDIDATE_ONLY"};
    item.flags=reviewFlags(item,{asOf});
    const dedup=[norm(item.title),norm(item.format),norm(item.persona),norm(item.stage)].join("|");
    if(seen.has(dedup))item.flags.push("REPEATED_COPY");
    seen.add(dedup);
    if(item.date)days.add(item.date);
    candidates.push(item);
  }
  const warnings=[];
  if(Number.isInteger(declaredDays)&&declaredDays>0&&days.size&&days.size!==declaredDays)warnings.push("MISLEADING_PLAN_SIZE");
  if(candidates.length&&candidates.every(x=>!x.date)&&Number.isInteger(declaredDays)&&declaredDays>0)warnings.push("SCHEDULE_UNDATED");
  return {status:"CANDIDATE_ONLY",scope:s,source:{source_key:source.source_key,revision:source.revision},counts:{rows:candidates.length,quarantined:rejected.length,distinct_dates:days.size},warnings,records:candidates,quarantine:rejected,side_effects:false,publication_authorized:false};
}

export function importCsv({text,scope,source,asOf,declaredDays}){
  return importMatrix({matrix:parseCsv(text),scope,source,asOf,declaredDays});
}

export function compileContext({scope,persona,policy,claims=[],channel,format,style}){
  guardContext({scope,persona,policy,claims,channel,style});
  const s=requireScoped(scope);
  if(!persona||persona.tenant_ref!==s.tenant_ref||persona.brand_ref!==s.brand_ref)throw new Error("PERSONA_SCOPE_MISMATCH");
  if(!policy||policy.tenant_ref!==s.tenant_ref||policy.brand_ref!==s.brand_ref)throw new Error("POLICY_SCOPE_MISMATCH");
  if(policy.restrictions?.includes("DENY_ALL"))return {state:"DENIED",reason:"GOVERNANCE_DENY",publication_authorized:false};
  if(!policy.channels||!policy.channels.includes(channel))return {state:"DENIED",reason:"CHANNEL_NOT_ALLOWED",publication_authorized:false};
  if(policy.locales&&!policy.locales.includes(s.locale))return {state:"DENIED",reason:"LOCALE_NOT_ALLOWED",publication_authorized:false};
  if(policy.styles&&!policy.styles.includes(style))return {state:"DENIED",reason:"STYLE_NOT_ALLOWED",publication_authorized:false};
  const eligible=[],blocked=[];
  for(const claim of claims){
    const ok=claim.tenant_ref===s.tenant_ref&&claim.brand_ref===s.brand_ref&&claim.state==="APPROVED"&&claim.evidence_ref&&claim.sensitivity==="public"&&!claim.revoked&&!claim.stale;
    if(ok)eligible.push(claim.id);
    else blocked.push({claim_ref:claim.id||"unidentified",reason:"UNVERIFIED_OR_WRONG_SCOPE"});
  }
  return {state:"PREVIEW_ONLY",scope:s,audience_role:persona.role||"unspecified",buyer_stage:persona.stage||"unspecified",channel,format,style,brand_voice:policy.voice||"unset",policy_revision:policy.revision||"unknown",candidate_claim_refs:eligible,excluded_claims:blocked,needs_independent_claim_verification:true,publication_authorized:false,execution_authorized:false};
}

export function verifyHostReceipt({receipt,expected,trust,verifier,replayStore,now}){
  const preflight=guardReceipt({receipt,expected,trust,verifier,replayStore,now});
  if(preflight)return preflight;
  const deny=reason=>({status:"DENIED",reason,operational_acceptance:false,publication_authorized:false,release_authorized:false});
  if(!receipt||!expected||!trust||!verifier||!replayStore)return deny("TRUST_SERVICES_MISSING");
  if(typeof verifier.verifyDetached!=="function"||typeof replayStore.consumeOnce!=="function")return deny("INDEPENDENT_VERIFIER_OR_REPLAY_STORE_REQUIRED");
  const fields=["exact_head","artifact_sha256","site_uuid","environment","source_generation"];
  if(fields.some(k=>!receipt[k]||receipt[k]!==expected[k]))return deny("PROVENANCE_MISMATCH");
  if(!receipt.verifier_id||!Array.isArray(trust.approved_verifiers)||!trust.approved_verifiers.includes(receipt.verifier_id))return deny("UNTRUSTED_VERIFIER");
  if(!receipt.signature||!receipt.nonce||!receipt.observed_at||!receipt.policy_digest||receipt.policy_digest!==expected.policy_digest)return deny("PROOF_FIELDS_MISSING");
  const t=Date.parse(receipt.observed_at),n=Date.parse(now);
  if(!Number.isFinite(t)||!Number.isFinite(n)||t>n+30000||n-t>300000)return deny("STALE_OR_FUTURE_EVIDENCE");
  const required=expected.required_checks||[];
  if(!Array.isArray(receipt.checks)||!required.every(x=>receipt.checks.some(c=>c.id===x&&c.pass===true)))return deny("REQUIRED_CHECK_NOT_PASSED");
  if(verifier.verifyDetached(receipt,trust)!==true)return deny("INVALID_SIGNATURE");
  if(replayStore.consumeOnce(receipt.verifier_id+"|"+receipt.nonce,receipt.observed_at)!==true)return deny("REPLAY_DETECTED");
  return {status:"ATTESTED_FOR_REVIEW_ONLY",checks:required.length,requires_human_approval:true,operational_acceptance:false,publication_authorized:false,release_authorized:false};
}

export function importPersonaMatrix({matrix,scope,source,persona_key}){
 guardMatrix(matrix,{requiredHeaders:[]});
 const bound=requireScoped(scope);
 if(!persona_key||typeof persona_key!=="string"||!source?.source_key||!source.revision||!Array.isArray(matrix)||!matrix.length)throw new Error("PERSONA_SOURCE_AND_REVISION_REQUIRED");
 const fields=[
 ["frustration","Frustrations","Frustrations - Why It Matters"],
 ["desire","Desires","Desires - Why It Matters"],
 ["fear","Fears","Fears - Why It Matters"],
 ["objection","Objections","Objections - Why It Matters"],
 ["pain_point","Pain Points","Pain Points – Why It Matters"],
 ["message_angle","Creative Messages","Creative Messages - Why It Matters"]
 ];
 const header=matrix[0].map(norm);
 const index=fields.map(([kind,text,why])=>({kind,from:header.indexOf(norm(text)),reason:header.indexOf(norm(why))}));
 if(index.some(x=>x.from<0||x.reason<0))throw new Error("PERSONA_MATRIX_HEADERS_MISSING");
 const records=[],quarantine=[];
 if(matrix.length>5001)throw new Error("ROW_LIMIT");
 for(let rowNum=1;rowNum<matrix.length;rowNum++){
  const row=matrix[rowNum];
  if(!Array.isArray(row)||row.length>64||row.some(v=>String(v??"").length>4096)){quarantine.push({row_index:rowNum+1,reason:"ROW_LIMIT"});continue;}
  if(row.some(suspiciousValue)){quarantine.push({row_index:rowNum+1,reason:"SENSITIVE_VALUE_QUARANTINED"});continue;}
  for(const {kind,from,reason} of index){
   const value=String(row[from]??"").trim(),why=String(row[reason]??"").trim();
   if(!value)continue;
   const flags=reviewFlags({title:value,writer_brief:why});
   if(!why)flags.push("MISSING_REASON");
   records.push({candidate_ref:`persona:${rowNum}:${kind}`,persona_key,kind,value,why_it_matters:why,flags,status:"CANDIDATE_ONLY",publish_authorized:false});
  }
 }
 return {status:"CANDIDATE_ONLY",scope:bound,source:{source_key:source.source_key,revision:source.revision},persona_key,records,quarantine,side_effects:false};
}

export function assessEditorialRow({row,headers,scope,source}){
 const scoped=requireScoped(scope);
 if(!Array.isArray(row)||!Array.isArray(headers)||!source?.source_key||!source.revision)throw new Error("PUBLISH_SOURCE_REQUIRED");
 const admission=guardEditorial({row,headers});
 if(admission)return {status:"QUARANTINED",reason:admission,publish_authorized:false,side_effects:false};
 if(row.some(suspiciousValue))return {status:"QUARANTINED",reason:"SENSITIVE_VALUE",publish_authorized:false};
 const h=headers.map(norm);
 const get=x=>{const i=h.indexOf(norm(x));return i>=0?String(row[i]??"").trim():""};
 const fields={title:get("Blog Title"),content:get("Blog Content"),excerpt:get("Excerpt"),slug:get("Slug"),status:get("Status"),featured_image:get("Blog Featured Image"),meta_title:get("SEO Meta Title"),meta_description:get("SEO Meta Description"),source_publish_ready:get("Publish Ready ?"),publish_date:get("Publish Date")};
 const flags=reviewFlags({title:fields.title,writer_brief:fields.content.slice(0,4096)});
 if(!fields.title)flags.push("MISSING_TITLE");
 if(!fields.content)flags.push("MISSING_BODY");
 if(!fields.slug)flags.push("MISSING_SLUG");
 if(!fields.meta_title||!fields.meta_description)flags.push("SEO_INCOMPLETE");
 if(!fields.featured_image)flags.push("IMAGE_NOT_REVIEWED");
 if(/^(yes|true|1|ready|نعم)$/i.test(fields.source_publish_ready))flags.push("SOURCE_READY_UNVERIFIED");
 return {status:"EDITORIAL_REVIEW_REQUIRED",scope:scoped,source:{source_key:source.source_key,revision:source.revision},content_complete:!!(fields.title&&fields.content&&fields.excerpt),seo_complete:!!(fields.meta_title&&fields.meta_description&&fields.slug),flags,publish_authorized:false,side_effects:false};
}

export function assessDocumentFidelity({mime_type,text,locale,independent_visual_receipt}){
 if(mime_type!=="application/pdf"&&!String(mime_type||"").startsWith("image/"))return {status:"UNSUPPORTED_MIME",certified:false};
 if(typeof text!=="string")throw new Error("TEXT_EXTRACTION_REQUIRED");
 const empty=!text.trim(),arabic=String(locale||"").toLowerCase().startsWith("ar");
 if(independent_visual_receipt)return {status:"VISUAL_RECEIPT_PRESENT_REQUIRES_EXTERNAL_VALIDATION",certified:false,text_available:!empty};
 return {status:empty?"VISUAL_REVIEW_REQUIRED":arabic?"TEXT_FIDELITY_REQUIRES_VISUAL_REVIEW":mime_type.startsWith("image/")?"VISUAL_REVIEW_REQUIRED":"TEXT_ONLY_UNVERIFIED",certified:false,text_available:!empty};
}
