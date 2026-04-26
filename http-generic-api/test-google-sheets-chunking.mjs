import { fetchChunkedTable } from "./googleSheets.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`[PASS] ${label}`);
    passed++;
  } else {
    console.error(`[FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function makeFakeSheets(responsesByRange = {}) {
  const calls = [];
  return {
    calls,
    spreadsheets: {
      values: {
        batchGet: async request => {
          calls.push(...request.ranges);
          return {
            data: {
              valueRanges: request.ranges.map(range => ({
                range,
                values: responsesByRange[range] || []
              }))
            }
          };
        }
      }
    }
  };
}

{
  const fakeSheets = makeFakeSheets({
    "'Workflow Registry'!A1:AL1": [["Workflow ID", "active"]],
    "'Workflow Registry'!A2:AL51": [["wf_1", "TRUE"]],
    "'Workflow Registry'!A52:AL101": [["wf_2", "FALSE"]]
  });

  const values = await fetchChunkedTable(fakeSheets, {
    spreadsheetId: "registry",
    sheetName: "Workflow Registry",
    columnStart: "A",
    columnEnd: "AL",
    dataEndRow: 2000,
    maxChunkReads: 2,
    chunkDelayMs: 1
  });

  assert(
    "reads header before row chunks",
    fakeSheets.calls[0] === "'Workflow Registry'!A1:AL1",
    JSON.stringify(fakeSheets.calls)
  );
  assert(
    "uses bounded 50-row chunks",
    fakeSheets.calls.includes("'Workflow Registry'!A2:AL51") &&
      fakeSheets.calls.includes("'Workflow Registry'!A52:AL101"),
    JSON.stringify(fakeSheets.calls)
  );
  assert(
    "honors explicit total chunk cap",
    fakeSheets.calls.length === 3 &&
      !fakeSheets.calls.includes("'Workflow Registry'!A1:AL2000"),
    JSON.stringify(fakeSheets.calls)
  );
  assert("returns header plus chunk rows", values.length === 3, JSON.stringify(values));
}

{
  const fakeSheets = makeFakeSheets({
    "'Workflow Registry'!A1:AL1": [["Workflow ID", "active"]],
    "'Workflow Registry'!A2:AL51": [["wf_1", "TRUE"]],
    "'Workflow Registry'!A102:AL151": [["wf_3", "TRUE"]]
  });

  const values = await fetchChunkedTable(fakeSheets, {
    spreadsheetId: "registry",
    sheetName: "Workflow Registry",
    columnStart: "A",
    columnEnd: "AL",
    dataEndRow: 151,
    chunkDelayMs: 1,
    cycleDelayMs: 1,
    maxChunkReadsPerCycle: 2
  });

  assert(
    "does not stop at an empty middle chunk by default",
    values.some(row => row[0] === "wf_3"),
    JSON.stringify({ calls: fakeSheets.calls, values })
  );
  assert(
    "covers the declared range when maxChunkReads is omitted",
    fakeSheets.calls.includes("'Workflow Registry'!A102:AL151"),
    JSON.stringify(fakeSheets.calls)
  );
}

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
