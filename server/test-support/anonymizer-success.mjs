import { stdin, stdout, stderr } from "node:process";

const chunks = [];
for await (const chunk of stdin) chunks.push(chunk);
stderr.write(`ANONYMIZATION_REPORT=${JSON.stringify({
  version: "fixture-1",
  detectors: { face: "ok", text: "ok", plate: "ok" },
  regions: { faces: 0, text: 0, plates: 0 },
  document: { suspected: process.env.ANONYMIZER_DOCUMENT_SUSPECTED === "true", textAreaRatio: 0 },
})}\n`);
stdout.write(Buffer.concat(chunks));
