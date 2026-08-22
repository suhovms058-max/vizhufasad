import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGenerationEditInput } from "../src/generation/contract.mjs";
import { composeGenerationPrompt } from "../src/generation/prompt.mjs";
import { GenerationService } from "../src/generation/service.mjs";

const baseInput = {
  style: "современный",
  materials: ["штукатурка"],
  palette: ["#EFE8DB"],
  transformationLevel: "gentle",
  preserve: {},
};

test("editor validates its scope and produces a strict protected-zone prompt", () => {
  const edit = normalizeGenerationEditInput({ scope: "walls", command: "Сделать стены светлее" });
  const prompt = composeGenerationPrompt({
    ...baseInput,
    preserve: {
      geometry: true, floors: true, noNewFloors: true, roof: true, windows: true,
      doors: true, balconies: true, terraces: true, plot: true, perspective: true,
      housePosition: true,
    },
    wishes: "",
    negativeConstraints: [],
  }, { edit }).prompt;
  assert.match(prompt, /wall finish surfaces only/u);
  assert.match(prompt, /Everything outside this boundary must remain visually identical/u);
  assert.throws(
    () => normalizeGenerationEditInput({ scope: "custom_mask", command: "Изменить" }),
    (error) => error.code === "EDIT_MASK_REQUIRED",
  );
});

test("editor creates a child version and reserves one text-revision credit", async () => {
  const events = [];
  let createdInput;
  const parent = {
    id: "parent-1",
    status: "completed",
    result_key: "parent.jpg",
    config_snapshot: baseInput,
  };
  const generation = { id: "edit-1", status: "created", kind: "edit", priority: 10 };
  const repository = {
    async findOwned(_userId, _projectId, generationId) {
      if (generationId === parent.id) return parent;
      return { ...generation, result_key: null };
    },
    async createEditOwned(input) {
      createdInput = input;
      return { generation, parent, created: true };
    },
    async hasPaidCredits() { return true; },
    async attachReservationAndQueue() { generation.status = "queued"; return generation; },
    async markFailedRefunded() {},
  };
  const walletService = {
    async reserve(_userId, input) {
      events.push(["reserve", input.actionCode]);
      return { transaction: { id: "reservation-1" } };
    },
    async refund() {},
  };
  const service = new GenerationService({
    repository,
    storage: { getStorageBucket() { return "private"; } },
    walletService,
    queue: { async enqueue() { events.push(["enqueue"]); } },
    config: { editorEnabled: true, queuePaidPriority: 1, queueFreePriority: 10 },
  });
  const result = await service.createEdit(
    "user-1", "project-1", parent.id,
    { scope: "plinth", command: "Заменить отделку цоколя на тёмный камень" },
    "edit-request-12345",
  );
  assert.equal(result.status, "queued");
  assert.equal(createdInput.parentGenerationId, parent.id);
  assert.equal(createdInput.editScope, "plinth");
  assert.equal(createdInput.editMaskKey, null);
  assert.deepEqual(events, [["reserve", "text_revision"], ["enqueue"]]);
});

test("version tree falls back to the latest completed node and restores without deleting descendants", async () => {
  const nodes = [
    { id: "base", parent_generation_id: null, revision: 1, status: "completed", is_selected: false },
    { id: "edit-1", parent_generation_id: "base", revision: 2, status: "completed", is_selected: false },
    { id: "edit-2", parent_generation_id: "base", revision: 3, status: "failed_refunded", is_selected: false },
  ];
  let selected;
  const repository = {
    async versionTreeOwned() { return nodes; },
    async selectVersionOwned(_userId, _projectId, generationId) {
      selected = generationId;
      return { generation_id: generationId };
    },
    async findOwned(_userId, _projectId, generationId) {
      return { id: generationId, status: "completed", result_key: `${generationId}.jpg` };
    },
  };
  const service = new GenerationService({ repository, storage: {}, walletService: {}, queue: {}, config: {} });
  const tree = await service.versionTree("owner", "project-1");
  assert.equal(tree.selectedGenerationId, "edit-1");
  assert.equal(tree.nodes.length, 3);
  const restored = await service.restoreVersion("owner", "project-1", "base");
  assert.equal(selected, "base");
  assert.equal(restored.id, "base");
  assert.equal(nodes.length, 3);
});
