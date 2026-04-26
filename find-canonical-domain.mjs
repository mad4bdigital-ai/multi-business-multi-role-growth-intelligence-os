import { CANONICALS } from './canonical-manifest.mjs';

const args = process.argv.slice(2).map((arg) => arg.trim()).filter(Boolean);

function usage() {
  console.log([
    'Usage: node find-canonical-domain.mjs [canonical] <query...>',
    '',
    'Examples:',
    '  node find-canonical-domain.mjs repair',
    '  node find-canonical-domain.mjs prompt_router repair',
    '  node find-canonical-domain.mjs wordpress publish',
    '  node find-canonical-domain.mjs activation runtime',
  ].join('\n'));
}

function normalize(value) {
  return value.toLowerCase().replace(/[_/-]+/g, ' ');
}

function canonicalKey(config) {
  return config.output.replace(/\.md$/, '');
}

function sourcePath(config, file) {
  return `${config.sourceDir}/${file}`;
}

function scoreMatch(haystack, terms) {
  return terms.reduce((score, term) => {
    if (haystack.includes(term)) {
      return score + (haystack.split(/\s+/).includes(term) ? 3 : 1);
    }
    return score;
  }, 0);
}

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

const canonicalNames = new Set(CANONICALS.map(canonicalKey));
const maybeCanonical = normalize(args[0]).replace(/\s+/g, '_');
const selectedCanonical = canonicalNames.has(maybeCanonical) ? maybeCanonical : null;
const queryArgs = selectedCanonical ? args.slice(1) : args;

if (queryArgs.length === 0) {
  usage();
  process.exit(1);
}

const terms = queryArgs.flatMap((arg) => normalize(arg).split(/\s+/)).filter(Boolean);
const candidates = [];

for (const config of CANONICALS) {
  const key = canonicalKey(config);
  if (selectedCanonical && key !== selectedCanonical) {
    continue;
  }

  for (const [domain, file, useWhen] of config.index) {
    const haystack = normalize([key, config.output, domain, file, useWhen].join(' '));
    const score = scoreMatch(haystack, terms);
    if (score > 0) {
      candidates.push({
        canonical: key,
        domain,
        file,
        path: sourcePath(config, file),
        score,
        useWhen,
      });
    }
  }
}

candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

if (candidates.length === 0) {
  console.error(`No canonical domain matched: ${queryArgs.join(' ')}`);
  process.exit(2);
}

for (const candidate of candidates.slice(0, 10)) {
  console.log(`${candidate.path}`);
  console.log(`  canonical: ${candidate.canonical}`);
  console.log(`  domain: ${candidate.domain}`);
  console.log(`  use when: ${candidate.useWhen}`);
}
