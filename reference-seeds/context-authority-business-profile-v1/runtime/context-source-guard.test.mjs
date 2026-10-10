import {test} from 'node:test';import assert from 'node:assert/strict';
import {strictParseCsv,guardMatrix,guardContext,guardEditorial,guardReceipt} from './context-source-guard.mjs';
const source={tenant_ref:'t',brand_ref:'b'};
const demo={scope:source,persona:source,policy:{...source,channels:['blog']},claims:[],channel:'blog',style:'educational'};
const expected={tenant_ref:'t',brand_ref:'b',exact_head:'head',artifact_sha256:'sha256',site_uuid:'site',environment:'staging',source_generation:'generation',policy_digest:'policy',required_checks:['content','scope']};
const receipt={...expected,verifier_id:'trust-a',nonce:'nonce-valid',signature:'opaque-signature',observed_at:'2026-10-10T00:00:00Z',checks:[{id:'content',pass:true},{id:'scope',pass:true}]};
const args={expected,receipt,trust:{approved_verifiers:['trust-a']},verifier:{verifyDetached:()=>true},replayStore:{consumeOnce:()=>true},now:'2026-10-10T00:01:00Z'};
test('quoted CSV and multiline correctly parsed',()=>{assert.deepEqual(strictParseCsv('\uFEFFTitle,Description\r\n"title, one","line one\nline two"\r\n'),[['Title','Description'],['title, one','line one\nline two']])});
test('invalid embedded quoting blocked',()=>assert.throws(()=>strictParseCsv('Title\nabc"def'),/CSV_INVALID_QUOTE/));
test('row and UTF8 byte caps fail closed',()=>{assert.throws(()=>strictParseCsv('a'.repeat(2_000_001)),/INPUT_BYTES_LIMIT/);assert.throws(()=>strictParseCsv('Title\n'+'a'.repeat(4097)),/CELL_LIMIT/)});
test('duplicated fields blocked',()=>assert.throws(()=>guardMatrix([['Content Title','content-title'],['x','y']]),/AMBIGUOUS_DUPLICATE_HEADER/));
test('sensitive/PII/formula not admitted',()=>{for(const cell of ['admin@example.com','=WEBSERVICE("x")','api_key=abcdefghi','\t+SUM(A1)','javascript:alert(1)'])assert.throws(()=>guardMatrix([['Content Title'],[cell]]),/SENSITIVE_SOURCE|FORMULA|SPREADSHEET/)});
test('headers containing private fields are not general context',()=>assert.throws(()=>guardMatrix([['Content Title','Email'],['title','x']]),/SENSITIVE_COLUMN/));
test('scope and embedded claim values blocked',()=>{assert.equal(guardContext(demo),true);assert.throws(()=>guardContext({...demo,persona:{...source,brand_ref:'other'}}),/PERSONA_SCOPE_MISMATCH/);assert.throws(()=>guardContext({...demo,claims:[{id:'id',raw:'secret'}]}),/CLAIM_VALUES_MUST_STAY/)});
test('valid host input passes preflight only, not approval',()=>assert.equal(guardReceipt(args),null));
test('missing required checks never passes',()=>assert.equal(guardReceipt({...args,expected:{...expected,required_checks:[]}}).reason,'REQUIRED_CHECK_POLICY_MISSING'));
test('failed extra check blocks even when required checks pass',()=>assert.equal(guardReceipt({...args,receipt:{...receipt,checks:[...receipt.checks,{id:'critical',pass:false}]}}).reason,'CHECK_SET_INVALID'));
test('duplicate checks blocked',()=>assert.equal(guardReceipt({...args,receipt:{...receipt,checks:[...receipt.checks,receipt.checks[0]]}}).reason,'CHECK_SET_INVALID'));
test('wrong site and revision blocked',()=>assert.equal(guardReceipt({...args,receipt:{...receipt,source_generation:'wrong'}}).reason,'PROVENANCE_MISMATCH'));
test('unknown environment blocked',()=>assert.equal(guardReceipt({...args,expected:{...expected,environment:'unknown'},receipt:{...receipt,environment:'unknown'}}).reason,'ENVIRONMENT_UNRECOGNIZED'));
test('untrusted verifier blocked',()=>assert.equal(guardReceipt({...args,trust:{approved_verifiers:[]}}).reason,'VERIFIER_NOT_ALLOWED'));
test('future or stale receipt blocked',()=>assert.equal(guardReceipt({...args,now:'2026-10-10T12:01:00Z'}).reason,'EVIDENCE_TIME_INVALID'));

test('cross-brand evidence refused',()=>assert.equal(guardReceipt({...args,receipt:{...receipt,brand_ref:'another'}}).reason,'PROVENANCE_MISMATCH'));
test('missing tenant binding refused',()=>{const {tenant_ref,...unsafe}=expected;assert.equal(guardReceipt({...args,expected:unsafe}).reason,'PROVENANCE_MISMATCH')});
test('claim site mismatch and duplicate IDs refused',()=>{assert.throws(()=>guardContext({...demo,scope:{...source,site_uuid:'s1'},claims:[{id:'c',site_uuid:'s2'}]}),/CLAIM_SITE_SCOPE_MISMATCH/);assert.throws(()=>guardContext({...demo,claims:[{id:'c'},{id:'c'}]}),/DUPLICATE_CLAIM_ID/)});

test('caller-stricter row/column/cell caps are enforced',()=>{assert.throws(()=>strictParseCsv('A,B',{maxColumns:1}),/COLUMN_LIMIT/);assert.throws(()=>strictParseCsv('Title\nx\ny',{maxRows:1}),/ROW_LIMIT/);assert.throws(()=>strictParseCsv('A\n12345',{maxCellLength:4}),/CELL_LIMIT/);assert.throws(()=>strictParseCsv('Title',{maxBytes:-1}),/INVALID_LIMIT/)});
test('email marketing headings are not automatically private email columns',()=>assert.equal(guardMatrix([['Content Title','Email Campaign'],['Article','Newsletter']]),true));

test('private editorial contact is quarantined without revealing content',()=>assert.equal(guardEditorial({headers:['Blog Title','Blog Content'],row:['Headline','Contact abc@example.com']}),'SENSITIVE_EDITORIAL_CONTENT'));
test('clean long editorial content not mistaken for short CSV cell',()=>assert.equal(guardEditorial({headers:['Blog Title','Blog Content'],row:['Article','A'.repeat(12000)]}),null));

test('numeric negative discounts remain data while expressions are quarantined',()=>{
 assert.equal(guardMatrix([['Content Title'],['-20%'],['-12.5']]),true);
 for(const s of ['-1+2','-SUM(A1)','+20%','=HYPERLINK(A1)','@SUM(A1)'])
   assert.throws(()=>guardMatrix([['Content Title'],[s]]),/SPREADSHEET_FORMULA_REQUIRES_QUARANTINE/);
});
