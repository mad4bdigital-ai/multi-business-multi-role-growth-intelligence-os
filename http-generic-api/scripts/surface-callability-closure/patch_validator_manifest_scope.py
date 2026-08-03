from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "scripts" / "resource-api-callability-contracts.mjs"
source = PATH.read_text(encoding="utf-8")

old = '  const contracts = [...(Array.isArray(baseContracts) ? baseContracts : []), ...loadContractManifests(root, findings)];'
new = '''  const includeCompanionManifests = manifest?.policy_key === "platform_resource_api_coverage_policy_v1";
  const contracts = [
    ...(Array.isArray(baseContracts) ? baseContracts : []),
    ...(includeCompanionManifests ? loadContractManifests(root, findings) : []),
  ];'''
if old in source:
    source = source.replace(old, new, 1)
elif new not in source:
    raise SystemExit("validator_companion_manifest_scope_marker_missing")

PATH.write_text(source, encoding="utf-8")
print("callability companion manifests limited to the governed root manifest")
