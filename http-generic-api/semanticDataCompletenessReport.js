import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.dirname(fileURLToPath(import.meta.url));
const lifecycle=JSON.parse(fs.readFileSync(path.join(root,"config","runtime-data-lifecycle-contract.json"),"utf8"));
const registry=JSON.parse(fs.readFileSync(path.join(root,"config","canonical-semantic-artifacts.json"),"utf8"));

function artifactKeys(dataset){
  return [...new Set([...(dataset?.artifact_keys||[]),...(dataset?.canonical_rows||[]).map((row)=>row.artifact_key).filter(Boolean)])];
}
function canonicalLifecycleClass(value){return value==="canonical_registry"||value==="mixed";}

export function buildCanonicalArtifactDependencyGraph(registryValue=registry){
  const artifacts=new Map((registryValue.artifacts||[]).map((item)=>[item.artifact_key,item]));
  const states=new Map();
  const order=[];
  const visiting=new Set();
  function visit(key,trail=[]){
    if(states.get(key)?.status==="ready") return states.get(key);
    if(visiting.has(key)){
      const state={status:"cycle",missing_dependencies:[],cycle:[...trail,key]};
      states.set(key,state);
      return state;
    }
    const artifact=artifacts.get(key);
    if(!artifact){
      const state={status:"missing",missing_dependencies:[key],cycle:[]};
      states.set(key,state);
      return state;
    }
    visiting.add(key);
    const missing=[];
    let cycle=[];
    for(const dependency of artifact.dependencies||[]){
      if(!artifacts.has(dependency)){missing.push(dependency);continue;}
      const dependencyState=visit(dependency,[...trail,key]);
      if(dependencyState.status==="missing") missing.push(...dependencyState.missing_dependencies);
      if(dependencyState.status==="cycle") cycle=cycle.length?cycle:dependencyState.cycle;
    }
    visiting.delete(key);
    const status=cycle.length?"cycle":missing.length?"missing":"ready";
    const state={status,missing_dependencies:[...new Set(missing)].sort(),cycle};
    states.set(key,state);
    if(status==="ready"&&!order.includes(key)) order.push(key);
    return state;
  }
  for(const key of artifacts.keys()) visit(key);
  const by_key=Object.fromEntries([...states.entries()].sort(([a],[b])=>a.localeCompare(b)));
  const unresolved=Object.entries(by_key).filter(([,state])=>state.status!=="ready").map(([key])=>key);
  return Object.freeze({
    contract:"mad4b.canonical-semantic-artifact-dag-status.v1",
    complete:unresolved.length===0,
    artifact_count:artifacts.size,
    topological_order:order,
    unresolved_artifacts:unresolved,
    by_key
  });
}

function replayabilityFor(dataset,artifacts){
  if(!canonicalLifecycleClass(dataset?.class))return "not_applicable";
  if(dataset?.completeness_policy==="explicit_dataset_declarations_only")return "guard_only";
  const keys=artifactKeys(dataset);const missing=keys.filter((key)=>!artifacts.has(key));
  if(dataset?.known_replay_gap===true||missing.length||keys.length===0)return "unresolved_debt";
  return "replayable";
}

export function buildSemanticDataCompletenessReport({observations={}}={}){
  const artifacts=new Map((registry.artifacts||[]).map((item)=>[item.artifact_key,item]));
  const dependencyGraph=buildCanonicalArtifactDependencyGraph(registry);
  const datasets=Object.entries(lifecycle.datasets||{}).map(([dataset_key,dataset])=>{
    const keys=artifactKeys(dataset);const missing=keys.filter((key)=>!artifacts.has(key));const observation=observations[dataset_key]||null;
    const replayability=replayabilityFor(dataset,artifacts);
    const present=observation?.present===true;const cardinality=Number.isInteger(observation?.cardinality)?observation.cardinality:null;
    const readback_status=observation?.readback_status||"not_observed";
    const canonicalClass=canonicalLifecycleClass(dataset.class);
    const dependencies=[...new Set(keys.flatMap((key)=>artifacts.get(key)?.dependencies||[]))].sort();
    const dependencyStates=keys.map((key)=>dependencyGraph.by_key[key]?.status||"missing");
    const dependency_status=!canonicalClass?"not_applicable":keys.length===0?"unresolved":
      dependencyStates.includes("cycle")?"cycle":dependencyStates.includes("missing")?"missing":"ready";
    return {dataset_key,lifecycle_class:dataset.class||"unclassified",canonical_artifact_keys:keys,missing_artifact_keys:missing,replayability,
      replay_strategy:dataset.replay_strategy||null,known_replay_gap:dataset.known_replay_gap===true,present:observation?present:null,cardinality,readback_status,
      canonical_artifact_dependencies:dependencies,dependency_status,
      repair_required:canonicalClass&&(replayability==="unresolved_debt"||dependency_status!=="ready"||readback_status==="missing"||readback_status==="ambiguous"||readback_status==="identity_conflict"),
      external_reprovision_required:dataset.class==="environment_state",operational_reseed_forbidden:dataset.class==="operational_state"||dataset.reseed_forbidden===true};
  }).sort((a,b)=>a.dataset_key.localeCompare(b.dataset_key));
  const families=(lifecycle.table_families||[]).map((family,index)=>({
    family_key:`family:${family.pattern||index}`,pattern:family.pattern||null,lifecycle_class:family.class||"unclassified",
    completeness_policy:family.completeness_policy||null,unregistered_family_member_policy:family.unregistered_family_member_policy||null,
    replayability:family.completeness_policy==="explicit_dataset_declarations_only"?"guard_only":family.known_replay_gap===true?"unresolved_debt":"not_applicable",
    known_replay_gap:family.known_replay_gap===true
  }));
  const unresolvedDatasets=datasets.filter((item)=>item.replayability==="unresolved_debt"||(["missing","cycle","unresolved"].includes(item.dependency_status)));
  const unresolvedFamilies=families.filter((item)=>item.replayability==="unresolved_debt");
  const canonicalDatasets=datasets.filter((item)=>canonicalLifecycleClass(item.lifecycle_class));
  const notReady=canonicalDatasets.filter((item)=>item.readback_status!=="ready");
  const unresolved=[...new Set([...unresolvedDatasets.map((item)=>item.dataset_key),...unresolvedFamilies.map((item)=>item.family_key)])];
  return {contract:"mad4b.semantic-data-completeness-report.v3",lifecycle_contract:lifecycle.contract,artifact_registry_contract:registry.contract,
    artifact_dependency_graph:dependencyGraph,
    complete:unresolved.length===0&&notReady.length===0&&dependencyGraph.complete===true,unresolved_replay_debt_count:unresolved.length,unresolved_replay_debt:unresolved,
    canonical_dataset_count:canonicalDatasets.length,not_ready_canonical_dataset_count:notReady.length,not_ready_canonical_datasets:notReady.map((item)=>item.dataset_key),
    datasets,families,production_mutation_performed:false,provider_mutation_performed:false,database_mutation_performed:false,secrets_included:false};
}
