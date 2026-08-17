import { evaluateProductionConfig } from "../productionConfigPreflight.js";

const result = evaluateProductionConfig(process.env);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
