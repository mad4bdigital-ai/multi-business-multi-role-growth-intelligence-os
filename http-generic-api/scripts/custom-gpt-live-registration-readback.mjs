import fs from "node:fs";
import {verifyCustomGptLiveRegistrationReadback,loadObservedFile} from "../customGptLiveRegistrationReadback.js";

const args=Object.fromEntries(process.argv.slice(2).reduce((acc,item,index,all)=>{
  if(item.startsWith("--")) acc.push([item.slice(2),all[index+1]&&!all[index+1].startsWith("--")?all[index+1]:"true"]);
  return acc;
},[]));
if(!args["observed-file"]||!args["expected-head-sha"]){
  console.error("Usage: node scripts/custom-gpt-live-registration-readback.mjs --observed-file <json> --expected-head-sha <sha>");
  process.exit(2);
}
const result=verifyCustomGptLiveRegistrationReadback({observed:loadObservedFile(args["observed-file"]),expectedHeadSha:String(args["expected-head-sha"])});
process.stdout.write(JSON.stringify(result,null,2)+"\n");
if(!result.ready) process.exit(1);
