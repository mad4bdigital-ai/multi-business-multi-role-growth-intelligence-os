import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_SCHEMA_PATH = path.join(__dirname, 'memory_schema.json');
const SCHEMAS_DIR = path.join(__dirname, 'schemas');

let hasErrors = false;

function error(msg) {
  console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
  hasErrors = true;
}

function warn(msg) {
  console.warn(`\x1b[33m[WARN]\x1b[0m  ${msg}`);
}

function info(msg) {
  console.log(`\x1b[36m[INFO]\x1b[0m  ${msg}`);
}

function success(msg) {
  console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`);
}

function loadJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    error(`Failed to parse ${path.relative(__dirname, filePath)}: ${e.message}`);
    return null;
  }
}

function findRefs(obj, refs = []) {
  if (typeof obj !== 'object' || obj === null) return refs;
  if (obj['$ref']) {
    refs.push(obj['$ref']);
  }
  for (const key in obj) {
    findRefs(obj[key], refs);
  }
  return refs;
}

function validateSchemas() {
  const rootSchema = loadJson(ROOT_SCHEMA_PATH);
  if (!rootSchema) return;

  const schemaFiles = fs.readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.json'));
  const schemas = {};

  for (const file of schemaFiles) {
    const filePath = path.join(SCHEMAS_DIR, file);
    schemas[file] = loadJson(filePath);
  }

  const referencedFiles = new Set();

  function checkRefsInFile(schemaObj, fileName) {
    const refs = findRefs(schemaObj);
    for (const ref of refs) {
      if (ref.startsWith('#/')) {
        const parts = ref.replace('#/', '').split('/');
        let current = schemaObj;
        for (const part of parts) {
          if (current[part] === undefined) {
            error(`Broken internal $ref in ${fileName}: ${ref}`);
            break;
          }
          current = current[part];
        }
      } else {
        const [filePath, pointer] = ref.split('#');
        const targetFileName = path.basename(filePath);

        referencedFiles.add(targetFileName);

        if (!schemas[targetFileName]) {
          error(`Broken external $ref in ${fileName}: File not found for ${ref}`);
          continue;
        }

        if (pointer) {
          const parts = pointer.replace(/^\//, '').split('/');
          let current = schemas[targetFileName];
          for (const part of parts) {
            if (current === undefined || current[part] === undefined) {
              error(`Broken pointer in $ref in ${fileName}: ${ref}`);
              break;
            }
            current = current[part];
          }
        }
      }
    }
  }

  info(`Validating $refs in memory_schema.json...`);
  checkRefsInFile(rootSchema, 'memory_schema.json');

  for (const file of schemaFiles) {
    info(`Validating $refs in schemas/${file}...`);
    checkRefsInFile(schemas[file], file);
  }

  for (const file of schemaFiles) {
    if (!referencedFiles.has(file)) {
      warn(`Orphaned schema file detected: schemas/${file} is not referenced anywhere.`);
    }
  }

  const properties = rootSchema.properties || {};
  const propKeys = Object.keys(properties);
  const inlineProps = [];

  for (const key of propKeys) {
    const prop = properties[key];
    // We consider it "inline" if it's relatively large (e.g., more than a simple $ref and a description)
    // Let's just track the raw size of everything to find the heaviest blocks
    inlineProps.push({
      key,
      size: JSON.stringify(prop).length
    });
  }

  inlineProps.sort((a, b) => b.size - a.size);

  const rootSize = fs.statSync(ROOT_SCHEMA_PATH).size;
  const rootSizeKb = (rootSize / 1024).toFixed(2);

  console.log(`\n----------------------------------------`);
  info(`Root Schema Stats`);
  info(`Total size: ${rootSizeKb} KB`);
  info(`Total top-level properties: ${propKeys.length}`);

  info(`Top 10 largest inline blocks:`);
  for (let i = 0; i < Math.min(10, inlineProps.length); i++) {
    const p = inlineProps[i];
    if (p.size > 200) { // Only show blocks larger than ~200 bytes
      info(`  - ${p.key}: ${(p.size / 1024).toFixed(2)} KB`);
    }
  }
  console.log(`----------------------------------------\n`);

  const MAX_ROOT_SIZE = 45 * 1024;
  if (rootSize > MAX_ROOT_SIZE) {
    error(`memory_schema.json is larger than 45 KB (${rootSizeKb} KB). You must move inline blocks to schemas/ to keep the root schema lean.`);
  }

  if (hasErrors) {
    console.error(`\n\x1b[31m[FAILED]\x1b[0m Validation failed with errors. Fix broken $refs before proceeding.`);
    process.exit(1);
  } else {
    success(`Validation passed successfully! Every $ref resolves correctly. Ready for phased extraction.`);
  }
}

validateSchemas();
