/** Strict, offline admission boundary; never grants publication, persistence, or source authority. */
const LIMITS = Object.freeze({bytes:2_000_000,rows:5000,columns:64,cell:4096});
const PRIVATE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_\s-]?key|client[_\s-]?secret|password|bearer|authorization|access[_\s-]?token|refresh[_\s-]?token)\s*(?:[:=]|\s+)\s*['"]?[A-Za-z0-9_./+\-=]{5,})/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const FORMULA = /^[\s\u0000-\u001f]*[=+\-@]/;
const HAZARD_HEADERS = /(?:password|secret|token|api[ _-]?key|access[ _-]?key|passport|national[ _-]?id|birth[ _-]?date|dob|authorization)|^(?:email|e-mail|email address|contact email|customer email|phone|phone number|customer phone)$/i;
function fail(code) { throw new Error(code); }
const name = s => String(s ?? '').normalize('NFKC').trim().toLocaleLowerCase('en').replace(/[\s_\-]+/g,' ');
function boundedText(input){ if(typeof input!=='string')fail('TEXT_REQUIRED'); if(BufferByteLength(input)>LIMITS.bytes) fail('INPUT_BYTES_LIMIT'); return input.replace(/^\uFEFF/,''); }
function BufferByteLength(input){return new TextEncoder().encode(input).length;}
/** RFC4180-style CSV with strict quote placement, BOM, CRLF and deterministic limits. */
export function strictParseCsv(text,options={}) {
  const bounded=(key,def)=>{const v=options[key];if(v===undefined)return def;if(!Number.isInteger(v)||v<1)fail('INVALID_LIMIT');return Math.min(def,v);};
  const bytes=bounded('maxBytes',LIMITS.bytes),rowCap=bounded('maxRows',LIMITS.rows),colCap=bounded('maxColumns',LIMITS.columns),cellCap=bounded('maxCellLength',LIMITS.cell);
  if(typeof text!=='string')fail('TEXT_REQUIRED');
  if(BufferByteLength(text)>bytes)fail(options.maxBytes===undefined?'INPUT_BYTES_LIMIT':'INPUT_SIZE_LIMIT');
  text=boundedText(text); const rows=[];let cells=[],v='',quoted=false,closed=false,started=false;
  const emitCell=()=>{if(v.length>cellCap)fail('CELL_LIMIT');cells.push(v);if(cells.length>colCap)fail('COLUMN_LIMIT');v='';started=false;closed=false;};
  const emitRow=()=>{emitCell();if(cells.some(x=>x!==''))rows.push(cells);cells=[];if(rows.length>rowCap+1)fail('ROW_LIMIT');};
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){ if(ch==='"'){if(text[i+1]==='"'){v+='"';i++;}else{quoted=false;closed=true;}}else v+=ch; }
    else if(ch===',' || ch==='\n' || ch==='\r'){
      if(ch===',')emitCell(); else {emitRow();if(ch==='\r'&&text[i+1]==='\n')i++;}
    } else if(ch==='"') {
      if(v!==''||started||closed)fail('CSV_INVALID_QUOTE');quoted=true;started=true;
    } else if(closed){ if(ch!==' '&&ch!=='\t')fail('CSV_TRAILING_CHAR_AFTER_QUOTE'); }
    else {v+=ch;started=true;}
    if(v.length>cellCap)fail('CELL_LIMIT');
  }
  if(quoted)fail('CSV_UNCLOSED_QUOTE');
  if(v!==''||cells.length||started||closed)emitRow();
  return rows;
}
export function guardMatrix(matrix,{requiredHeaders=['content title','blog title','title','content blog article','idea','content idea','عنوان المحتوى','عنوان المحتوي','العنوان','عنوان']}={}){
  if(!Array.isArray(matrix)||!matrix.length||matrix.length>LIMITS.rows+1)fail('MATRIX_BOUNDS');
  if(!Array.isArray(matrix[0])||!matrix[0].length||matrix[0].length>LIMITS.columns)fail('INVALID_HEADER');
  const headers=matrix[0].map(x=>String(x??''));
  const nonempty=headers.map(name).filter(Boolean);
  if(nonempty.length!==new Set(nonempty).size)fail('AMBIGUOUS_DUPLICATE_HEADER');
  if(requiredHeaders.length && !headers.some(h=>requiredHeaders.includes(name(h))))fail('REQUIRED_COLUMN_ABSENT');
  if(headers.some(h=>HAZARD_HEADERS.test(h)))fail('SENSITIVE_COLUMN_REQUIRES_PRIVATE_CONNECTOR');
  for(const row of matrix){
    if(!Array.isArray(row)||row.length>LIMITS.columns)fail('COLUMN_LIMIT');
    for(const cell of row){
      if(cell!==null && typeof cell==='object')fail('UNSAFE_CELL_TYPE');
      const x=String(cell??'');
      if(BufferByteLength(x)>LIMITS.cell)fail('CELL_LIMIT');
      if(PRIVATE.test(x)||EMAIL.test(x))fail('SENSITIVE_SOURCE_REQUIRES_PRIVATE_QUARANTINE');
      if(FORMULA.test(x)||/^\s*javascript\s*:/i.test(x))fail('SPREADSHEET_FORMULA_REQUIRES_QUARANTINE');
    }
  }
  return true;
}
export function guardContext({scope,persona,policy,claims=[],channel,style}){
  if(!scope||!scope.tenant_ref||!scope.brand_ref||!persona||!policy)fail('SCOPE_REQUIRED');
  if(persona.tenant_ref!==scope.tenant_ref||persona.brand_ref!==scope.brand_ref)fail('PERSONA_SCOPE_MISMATCH');
  if(policy.tenant_ref!==scope.tenant_ref||policy.brand_ref!==scope.brand_ref)fail('POLICY_SCOPE_MISMATCH');
  if(!Array.isArray(policy.channels)||policy.channels.some(x=>typeof x!=='string'))fail('CHANNEL_POLICY_INVALID');
  if(!Array.isArray(claims)||claims.length>1000)fail('CLAIM_BUDGET');
  const seenIds=new Set();
  for(const c of claims){
    if(!c||typeof c!=='object')fail('INVALID_CLAIM');
    if(c.value!==undefined||c.raw!==undefined)fail('CLAIM_VALUES_MUST_STAY_IN_SOURCE_VAULT');
    if(typeof c.id!=='string'||c.id.length>160)fail('CLAIM_ID_INVALID');
    if(PRIVATE.test(c.id))fail('CLAIM_REF_LEAKAGE');
    if(seenIds.has(c.id))fail('DUPLICATE_CLAIM_ID');
    seenIds.add(c.id);
    if(scope.site_uuid && c.site_uuid && c.site_uuid!==scope.site_uuid)fail('CLAIM_SITE_SCOPE_MISMATCH');
  }
  if(typeof channel!=='string'||!channel)fail('CHANNEL_REQUIRED');
  if(style!==undefined&&typeof style!=='string')fail('STYLE_INVALID');
  return true;
}
/** Editorial content may be long, but must not silently contain personal or credential values. */
export function guardEditorial({row,headers}) {
  if(!Array.isArray(row)||!Array.isArray(headers)||row.length>LIMITS.columns||headers.length>LIMITS.columns)return 'INVALID_EDITORIAL_MATRIX';
  if(headers.some(h=>HAZARD_HEADERS.test(String(h??''))))return 'SENSITIVE_EDITORIAL_COLUMN';
  for(const c of row){
    if(c!==null&&typeof c==='object')return 'UNSAFE_EDITORIAL_VALUE';
    const s=String(c??'');
    if(BufferByteLength(s)>200_000)return 'EDITORIAL_CELL_TOO_LARGE';
    if(PRIVATE.test(s)||EMAIL.test(s))return 'SENSITIVE_EDITORIAL_CONTENT';
    if(FORMULA.test(s)||/^\s*javascript\s*:/i.test(s))return 'EDITORIAL_FORMULA';
  }
  return null;
}
/** Prevalidate host-attested evidence *before* invoking externally supplied verifier callbacks. */
export function guardReceipt({receipt,expected,trust,verifier,replayStore,now}){
  const deny=reason=>({status:'DENIED',reason,operational_acceptance:false,publication_authorized:false,release_authorized:false});
  if(!receipt||!expected||!trust||!verifier||!replayStore||!now)return deny('MISSING_HOST_EVIDENCE');
  if(typeof verifier.verifyDetached!=='function'||typeof replayStore.consumeOnce!=='function')return deny('VERIFIER_OR_REPLAY_STORE_UNAVAILABLE');
  const required=['tenant_ref','brand_ref','exact_head','artifact_sha256','site_uuid','environment','source_generation','policy_digest'];
  if(required.some(k=>typeof expected[k]!=='string'||!expected[k]||receipt[k]!==expected[k]))return deny('PROVENANCE_MISMATCH');
  if(!['staging','production','development','test'].includes(receipt.environment))return deny('ENVIRONMENT_UNRECOGNIZED');
  if(!Array.isArray(expected.required_checks)||!expected.required_checks.length||new Set(expected.required_checks).size!==expected.required_checks.length)return deny('REQUIRED_CHECK_POLICY_MISSING');
  if(!Array.isArray(receipt.checks)||new Set(receipt.checks.map(x=>x?.id)).size!==receipt.checks.length || receipt.checks.some(x=>!x||x.pass!==true))return deny('CHECK_SET_INVALID');
  if(expected.required_checks.some(k=>!receipt.checks.some(c=>c.id===k&&c.pass===true)))return deny('REQUIRED_CHECK_NOT_PASSED');
  if(!Array.isArray(trust.approved_verifiers)||!trust.approved_verifiers.includes(receipt.verifier_id))return deny('VERIFIER_NOT_ALLOWED');
  if(typeof receipt.signature!=='string'||!receipt.signature||typeof receipt.nonce!=='string'||receipt.nonce.length<3)return deny('SIGNATURE_OR_NONCE_MISSING');
  const t=Date.parse(receipt.observed_at),n=Date.parse(now);
  if(!Number.isFinite(t)||!Number.isFinite(n)||t>n+30000||n-t>300000)return deny('EVIDENCE_TIME_INVALID');
  return null;
}
