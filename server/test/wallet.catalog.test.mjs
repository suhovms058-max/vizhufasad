import assert from "node:assert/strict";
import test from "node:test";

import { WalletService } from "../src/wallet/service.mjs";

test("catalog exposes only the newest active version of each action cost", async () => {
  const service = new WalletService({
    config: {
      tariffCatalogEnabled: true,
      walletEnabled: true,
      paymentsEnabled: true,
    },
    clock: () => new Date("2026-08-28T00:00:00.000Z"),
    repository: {
      async listTariffs() { return []; },
      async listActionCosts() {
        return [
          { code: "standard_generation", name: "Обычная генерация", credits: 1, valid_from: "2026-07-28T21:00:00.000Z" },
          { code: "download", name: "Скачивание", credits: 0, valid_from: "2026-07-28T21:00:00.000Z" },
          { code: "standard_generation", name: "Генерация фасада", credits: 1, valid_from: "2026-08-23T00:00:00.000Z" },
          { code: "download", name: "Скачивание", credits: 0, valid_from: "2026-08-23T00:00:00.000Z" },
        ];
      },
    },
  });

  const catalog = await service.catalog();

  assert.deepEqual(catalog.actions.map(({ code, name, credits }) => ({ code, name, credits })), [
    { code: "download", name: "Скачивание", credits: 0 },
    { code: "standard_generation", name: "Генерация фасада", credits: 1 },
  ]);
});
