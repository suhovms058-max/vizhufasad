import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import express from "express";
import { LEGAL_DOCUMENTS } from "../src/legal/documents.mjs";
import { createLegalPagesRouter } from "../src/legal/pages.mjs";

test("legal center exposes versioned documents without draft placeholders", async () => {
  const app = express();
  app.use(createLegalPagesRouter());
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const index = await (await fetch(`${base}/legal`)).text();
    assert.equal((index.match(/class="panel legal-card"/gu) || []).length, LEGAL_DOCUMENTS.length);
    assert.match(index, /Сухов Максим Сергеевич/u);
    assert.match(index, /rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"/u);
    assert.match(index, /rel="shortcut icon" href="\/favicon-32x32\.png"/u);
    for (const document of LEGAL_DOCUMENTS) {
      assert.match(document.hash, /^[a-f0-9]{64}$/u);
      const response = await fetch(`${base}/legal/${document.key}`);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, new RegExp(document.hash, "u"));
      assert.doesNotMatch(html, /ТРЕБУЕТ|не публиковать|\[[^\]]+\]/u);
    }
  } finally {
    server.close();
    await once(server, "close");
  }
});
