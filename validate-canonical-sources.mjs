import fs from 'node:fs/promises';
import path from 'node:path';
import { CANONICALS } from './canonical-manifest.mjs';

const ROOT = process.cwd();
const GENERATED_MARKER = '<!-- GENERATED FILE. Edit canonicals sources and run node build-canonicals.mjs. -->';

function rel(...parts) {
  return path.join(ROOT, ...parts);
}

function countCodeFences(content) {
  return [...content.matchAll(/```/g)].length;
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

async function listMarkdownFiles(sourceDir) {
  const entries = await fs.readdir(rel(sourceDir), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
}

async function validateRootOutput(config) {
  const outputPath = rel(config.output);
  const content = await fs.readFile(outputPath, 'utf8');

  if (!content.startsWith(GENERATED_MARKER)) {
    throw new Error(`${config.output} is missing generated-file marker.`);
  }

  if (!content.includes('## Domain Index')) {
    throw new Error(`${config.output} is missing Domain Index.`);
  }

  for (const [, file] of config.index) {
    const indexedPath = `${config.sourceDir}/${file}`;
    if (!content.includes(`\`${indexedPath}\``)) {
      throw new Error(`${config.output} Domain Index does not include ${indexedPath}.`);
    }
  }
}

async function validateSourceDir(config) {
  const files = await listMarkdownFiles(config.sourceDir);
  const indexedFiles = config.index.map(([, file]) => file);

  assertUnique(indexedFiles, `${config.output} index file`);

  if (files.length !== config.expectedFileCount) {
    throw new Error(`${config.sourceDir} expected ${config.expectedFileCount} files, found ${files.length}.`);
  }

  const fileSet = new Set(files);
  const indexedFileSet = new Set(indexedFiles);

  for (const file of indexedFiles) {
    if (!fileSet.has(file)) {
      throw new Error(`${config.output} index references missing source file: ${config.sourceDir}/${file}`);
    }
  }

  for (const file of files) {
    if (!indexedFileSet.has(file)) {
      throw new Error(`${config.sourceDir}/${file} exists but is not listed in canonical manifest.`);
    }

    if (!/^\d{2}_[a-z0-9_]+\.md$/.test(file)) {
      throw new Error(`${config.sourceDir}/${file} must use numeric prefix naming.`);
    }

    const content = await fs.readFile(rel(config.sourceDir, file), 'utf8');
    if (content.trim().length === 0) {
      throw new Error(`${config.sourceDir}/${file} is empty.`);
    }

    if (countCodeFences(content) % 2 !== 0) {
      throw new Error(`${config.sourceDir}/${file} has an unbalanced Markdown code fence.`);
    }
  }
}

async function validateCanonical(config) {
  await validateRootOutput(config);
  await validateSourceDir(config);
  console.log(`Validated ${config.output} source structure.`);
}

assertUnique(CANONICALS.map((config) => config.output), 'canonical output');
assertUnique(CANONICALS.map((config) => config.sourceDir), 'canonical sourceDir');

for (const config of CANONICALS) {
  await validateCanonical(config);
}
