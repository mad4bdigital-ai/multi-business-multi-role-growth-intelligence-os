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

export function parseCsv(input,{maxBytes=2000000,maxRows=5000,maxColumns=64,maxCellLength=4096}={}){
  if(typeof input!=="string")throw new Error("INPUT_TEXT_REQUIRED");
  if(input.length>maxBytes)throw new Error("INPUT_SIZE_LIMIT");
  const rows=[];let row=[],cell="",quote=false,afterQuote=false;
  input=input.replace(/^\uFEFF/,"");
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(quote){if(c==='"'&&input[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quote=false;afterQuote=true;}else cell+=c;}
    else if(c==='"'&&cell===""&&!afterQuote){quote=true;}
    else if(c===','||c==='\n'||c==='\r'){
      row.push(cell);cell="";afterQuote=false;
      if(row.length>maxColumns)throw new Error("COLUMN_LIMIT");
      if(c!==','){
        if(c==='\r'&&input[i+1]==='\n')i++;
        if(row.some(x=>x!==""))rows.push(row);
        row=[];if(rows.length>maxRows+1)throw new Error("ROW_LIMIT");
      }
    } else {
      if(afterQuote&&c!==" "&&c!=="\t")throw new Error("CSV_INVALID_QUOTING");
      cell+=c;
    }
    if(cell.length>maxCellLength)throw new Error("CELL_LIMIT");
  }
  if(quote)throw new Error("CSV_UNCLOSED_QUOTE");
  if(cell!==""||row.length){row.push(cell);if(row.some(x=>x!==""))rows.push(row);}
  if(rows.length>maxRows+1)throw new Error("ROW_LIMIT");
  return rows;
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
