import fs from 'node:fs/promises';
import path from 'node:path';
import { CANONICALS } from './canonical-manifest.mjs';

const ROOT = process.cwd();
const CHECK_ONLY = process.argv.includes('--check');

function sourcePath(config, file) {
  return `${config.sourceDir}/${file}`;
}

function renderDomainIndex(config) {
  const rows = config.index
    .map(([domain, file, useWhen]) => `| ${domain} | \`${sourcePath(config, file)}\` | ${useWhen} |`)
    .join('\n');

  return [
    '## Domain Index',
    '',
    `This file is generated from \`${config.sourceDir}/\`.`,
    'Edit source files under `canonicals/`; do not edit this root file directly.',
    '',
    '| Domain | Source file | Use when |',
    '|---|---|---|',
    rows,
    '',
    '---',
    '',
  ].join('\n');
}

function normalizeOutputNewlines(content) {
  return content.replace(/\r\n/g, '\n');
}

async function assertIndexFilesExist(config, files) {
  const sourceFiles = new Set(files);
  for (const [, file] of config.index) {
    if (!sourceFiles.has(file)) {
      throw new Error(`${config.output} Domain Index references missing source file: ${file}`);
    }
  }
}

async function readSourceFiles(config) {
  const dir = path.join(ROOT, config.sourceDir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();

  if (files.length === 0) {
    throw new Error(`No markdown source files found in ${config.sourceDir}`);
  }

  await assertIndexFilesExist(config, files);

  const parts = [];
  for (const file of files) {
    if (!/^\d{2}_[a-z0-9_]+\.md$/.test(file)) {
      throw new Error(`Source file must use numeric prefix naming: ${config.sourceDir}/${file}`);
    }

    const fullPath = path.join(dir, file);
    const content = await fs.readFile(fullPath, 'utf8');
    if (content.trim().length === 0) {
      throw new Error(`Source file is empty: ${config.sourceDir}/${file}`);
    }

    parts.push(content);
  }

  return { files, parts };
}

async function buildCanonical(config) {
  const { files, parts } = await readSourceFiles(config);
  const output = [
    '<!-- GENERATED FILE. Edit canonicals sources and run node build-canonicals.mjs. -->',
    '',
    renderDomainIndex(config),
    parts.join(''),
  ].join('\n');

  const normalizedOutput = normalizeOutputNewlines(output.endsWith('\n') ? output : `${output}\n`);
  if (CHECK_ONLY) {
    const outputPath = path.join(ROOT, config.output);
    const existingOutput = normalizeOutputNewlines(await fs.readFile(outputPath, 'utf8'));
    if (existingOutput !== normalizedOutput) {
      throw new Error(`${config.output} is out of date. Run node build-canonicals.mjs and commit the generated output.`);
    }

    console.log(`Checked ${config.output} from ${files.length} source files.`);
    return;
  }

  await fs.writeFile(path.join(ROOT, config.output), normalizedOutput, 'utf8');
  console.log(`Built ${config.output} from ${files.length} source files.`);
}

for (const config of CANONICALS) {
  await buildCanonical(config);
}
