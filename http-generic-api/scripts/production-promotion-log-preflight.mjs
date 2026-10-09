#!/usr/bin/env node
// Local/operator read-only log check. Never publish or upload raw Production logs.
import {readFileSync} from "node:fs";
import {assessProductionPromotionLog} from "../productionPromotionLogPreflight.js";

const args=process.argv.slice(2);
const take=(key)=>{const idx=args.indexOf(key);return idx>=0?args[idx+1]:undefined;};
const filename=take("--log-file");
const expectedSourceSha=take("--expected-source-sha");
const queueRequired=args.includes("--queue-required");
if(!filename||!expectedSourceSha||![64,40].includes(expectedSourceSha.length)||
   !/^[0-9a-f]{40}$/.test(expectedSourceSha)){
  process.stderr.write("usage: node production-promotion-log-preflight.mjs --log-file <local-log> --expected-source-sha <40hex> [--queue-required]\n");
  process.exitCode=2;
}else{
  try{
    const report=assessProductionPromotionLog(readFileSync(filename,"utf8"),
      {expectedSourceSha,queueRequired});
    process.stdout.write(JSON.stringify(report,null,2)+"\n");
    // This CLI is a mandatory diagnostic blocker, never a grant of authority.
    process.exitCode=report.operational_blockers.length?2:0;
  }catch(e){
    process.stderr.write("production_preflight_log_unavailable_or_invalid\n");
    process.exitCode=2;
  }
}
