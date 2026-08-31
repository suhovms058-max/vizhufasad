import { stdin, stdout, stderr } from "node:process";
import { appendFile } from "node:fs/promises";

const tracePath = process.env.ANONYMIZER_TRACE_PATH;
if (tracePath) await appendFile(tracePath, `start:${process.pid}\n`);
const delayMs = Number(process.env.ANONYMIZER_DELAY_MS || 0);
if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

const chunks = [];
for await (const chunk of stdin) chunks.push(chunk);
if (tracePath) await appendFile(tracePath, `end:${process.pid}\n`);
stderr.write(`ANONYMIZATION_REPORT=${JSON.stringify({
  version: "fixture-1",
  detectors: { face: "ok", text: "ok", plate: "ok" },
  regions: { faces: 0, text: 0, plates: 0 },
  document: { suspected: process.env.ANONYMIZER_DOCUMENT_SUSPECTED === "true", textAreaRatio: 0 },
})}\n`);
stdout.write(Buffer.concat(chunks));
