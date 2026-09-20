import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.dirname(fileURLToPath(import.meta.url));
const lifecycle=JSON.parse(fs.readFileSync(path.join(root,"config","runtime-data-lifecycle-contract.json"),"utf8"));
const registry=JSON.parse(fs.readFileSync(path.join(root,"config","canonical-semantic-artifacts.json"),"utf8"));

function artifactKeys(dataset){return [...new Set((dataset?.canonical_rows||[]).map((row)=>row.artifact_key).filter(Boolean))];}
export function buildSemanticDataCompletenessReport({observations={}}={}){
  const artifacts=new Map((registry.artifacts||[]).map((item)=>[item.artifact_key,item]));
  const datasets=Object.entries(lifecycle.datasets||{}).map(([dataset_key,dataset])=>{
    const keys=artifactKeys(dataset);const missing=keys.filter((key)=>!artifacts.has(key));const observation=observations[dataset_key]||null;
    const canonicalClass=dataset.class==="canonical_registry"||dataset.class==="mixed";
    const replayability=!canonicalClass?"not_applicable":dataset.known_replay_gap===true||missing.length?"unresolved_debt":"replayable";
    const present=observation?.present===true;const cardinality=Number.isInteger(observation?.cardinality)?observation.cardinality:null;
    const readback_status=observation?.readback_status||"not_observed";
    return {dataset_key,lifecycle_class:dataset.class||"unclassified",canonical_artifact_keys:keys,missing_artifact_keys:missing,replayability,known_replay_gap:dataset.known_replay_gap===true,
      present:observation?present:null,cardinality,readback_status,repair_required:canonicalClass&&(replayability==="unresolved_debt"||readback_status==="missing"||readback_status==="ambiguous"),
      external_reprovision_required:dataset.class==="environment_state",operational_reseed_forbidden:dataset.class==="operational_state"||dataset.reseed_forbidden===true};
  }).sort((a,b)=>a.dataset_key.localeCompare(b.dataset_key));
  const unresolved=datasets.filter((item)=>item.replayability==="unresolved_debt");
  return {contract:"mad4b.semantic-data-completeness-report.v1",lifecycle_contract:lifecycle.contract,artifact_registry_contract:registry.contract,
    complete:unresolved.length===0&&datasets.filter((item)=>item.lifecycle_class==="canonical_registry"||item.lifecycle_class==="mixed").every((item)=>item.readback_status==="ready"),
    unresolved_replay_debt_count:unresolved.length,unresolved_replay_debt:unresolved.map((item)=>item.dataset_key),datasets,
    production_mutation_performed:false,provider_mutation_performed:false,database_mutation_performed:false,secrets_included:false};
}
