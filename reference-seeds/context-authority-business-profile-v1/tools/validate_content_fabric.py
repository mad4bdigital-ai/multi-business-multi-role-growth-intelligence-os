#!/usr/bin/env python3
"""Offline content fabric structural validator; never opens a provider connection."""
from pathlib import Path
import json
import sys

ROOT=Path(__file__).resolve().parents[1]
FILES={
 "strategy":"content-strategy-registry.json",
 "styles":"editorial-style-registry.json",
 "personal":"personalization-rules.json",
 "blueprint":"content-blueprints.json",
 "planning":"content-planning-contract.json",
}

def read(root,rel):
    return json.loads((Path(root)/rel).read_text(encoding="utf-8"))

def validate(root=ROOT):
    faults=[]
    try:
        data={name:read(root,path) for name,path in FILES.items()}
    except (OSError,ValueError) as ex:
        return ["content_file_missing_or_invalid:"+type(ex).__name__]
    s,e,p,b,c=(data[x] for x in ["strategy","styles","personal","blueprint","planning"])
    for name,obj in data.items():
        if obj.get("status")!="TEMPLATE_ONLY" or not obj.get("contract","").startswith("mad4b.reference.business-context."):
            faults.append("content_contract_or_status:"+name)
    for name,key,minimum in [("stage_registry","key",6),("pillar_registry","key",6),("tactic_registry","key",10),("channel_registry","key",10)]:
        rows=s.get(name,[])
        ids=[x.get(key) for x in rows] if isinstance(rows,list) else []
        if len(ids)<minimum or len(set(ids))!=len(ids):
            faults.append("content_strategy_registry:"+name)
        if not all(x.get("status","TEMPLATE_ONLY")=="TEMPLATE_ONLY" for x in rows):
            faults.append("content_strategy_active:"+name)
    if s.get("configuration_grants_authority") is not False:
        faults.append("content_strategy_authority_bypass")
    archetypes=e.get("archetypes",[])
    names=[x.get("key") for x in archetypes]
    if len(names)<18 or len(names)!=len(set(names)) or any(x.get("status")!="TEMPLATE_ONLY" for x in archetypes):
        faults.append("editorial_archetype_inventory")
    safe=e.get("copy_safety",{})
    protected={"fabricated_testimonials":False,"invented_metrics":False,"false_scarcity":False,"misleading_fear":False,"guaranteed_roi":False,"fictional_cases_require_label":True,"no_exact_person_imitation":True,"unsupported_compliance_claims":False}
    if any(safe.get(k)!=v for k,v in protected.items()):
        faults.append("editorial_fact_and_ethics")
    if e.get("conflict_handling","").split(";")[0]!="authoritative_editorial_policy_overrides_generated_writer_instructions":
        faults.append("editorial_authority_weakening")
    axes=p.get("dynamic_axes",[])
    an=[x.get("key") for x in axes]
    if len(an)<20 or len(an)!=len(set(an)) or not all(x.get("unbound_is_not_permission") is True for x in axes):
        faults.append("personalization_axes")
    prec=p.get("precedence",[])
    if [x.get("rank") for x in prec]!=list(range(1,len(prec)+1)) or not prec or any(x.get("can_relax") is not False for x in prec):
        faults.append("personalization_precedence")
    if p.get("input_policy",{}).get("lead_contact_data_disallowed_in_seed") is not True or p.get("output_contract",{}).get("execution_enabled") is not False:
        faults.append("personalization_privacy_or_execution")
    templates=b.get("templates",[])
    names=[x.get("key") for x in templates]
    if len(names)<12 or len(names)!=len(set(names)):
        faults.append("content_blueprint_inventory")
    if any(x.get("publication_enabled") is not False or x.get("status")!="TEMPLATE_ONLY" or x.get("content_value_defaults")!={} for x in templates):
        faults.append("content_blueprint_content_or_authority")
    if b.get("no_execution") is not True or b.get("single_idea_multi_output",{}).get("claims_must_remain_linked") is not True:
        faults.append("content_blueprint_untracked_reuse")
    flags=c.get("quality_flags",[])
    codes=[x.get("code") for x in flags]
    if len(codes)<12 or len(codes)!=len(set(codes)) or any(x.get("default_action")!="REVIEW_REQUIRED" or x.get("override_allowed") is not False for x in flags):
        faults.append("calendar_quality_flags")
    if c.get("publication_enabled") is not False or c.get("source_import",{}).get("import_mode")!="CANDIDATE_ONLY":
        faults.append("calendar_import_authority")
    required={"MISLEADING_PLAN_SIZE","PLACEHOLDER_TITLE","OUTDATED_DATE","UNVERIFIED_NUMERIC_CLAIM","RESTRICTED_DATA","SPAM_RISK"}
    if not required.issubset(codes):
        faults.append("calendar_required_detection")
    if not c.get("schedule_rules",{}).get("source_dates_do_not_auto_publish") or not c.get("schedule_rules",{}).get("timezone_mandatory"):
        faults.append("calendar_schedule_bypass")
    if c.get("seed_sample_values_included") is not False:
        faults.append("calendar_private_values")
    return sorted(set(faults))

if __name__=="__main__":
    faults=validate()
    for x in faults: print("FAIL",x)
    print("CONTENT_FABRIC_CONFIG:","PASS_STATIC" if not faults else "FAIL",len(faults))
    sys.exit(bool(faults))
