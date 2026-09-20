import {buildSemanticDataCompletenessReport} from "../semanticDataCompletenessReport.js";
process.stdout.write(JSON.stringify(buildSemanticDataCompletenessReport(),null,2)+"\n");
