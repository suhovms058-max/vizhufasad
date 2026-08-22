import path from "node:path";
import express from "express";
import { createGenerationRouter } from "../src/generation/http.mjs";
import { createComparisonRouter } from "../src/comparison/http.mjs";
import { createProjectsRouter } from "../src/projects/http.mjs";
import { createProjectPagesRouter } from "../src/projects/pages.mjs";
import { createUpscaleRouter } from "../src/upscale/http.mjs";

const baseUrl = "http://127.0.0.1:4173";
const statuses = ["queued", "preprocessing", "generating", "quality_check_pending", "completed"];
let statusIndex = 0;
let favorite = false;
let configuration = null;
let editGeneration = null;
let comparisonWinner = null;

const project = () => ({
  id: "project-e2e", title: "Дом для e2e", status: statuses[statusIndex] === "completed" ? "ready" : "configuration_required",
  image_id: "image-e2e", thumbnailUrl: `${baseUrl}/fixture/source.svg`, updated_at: new Date("2026-08-02T08:00:00Z"),
  configuration,
  assessment: { status: "completed", decision: "accepted_with_warning", userResult: {
    title: "Фото подходит", summary: "Фасад виден полностью. Можно продолжать.", recommendations: ["Дневной свет улучшит детализацию"],
  } },
});
const generation = () => ({
  id: "11111111-1111-4111-8111-111111111111", revision: 1, kind: "standard", status: statuses[statusIndex],
  resultAvailable: statuses[statusIndex] === "completed", requires_watermark: true,
  is_favorite: favorite, created_at: new Date("2026-08-02T09:00:00Z"),
  config_snapshot: configuration || { style: "автоподбор", materials: [], palette: ["автоподбор"], transformationLevel: "gentle" },
});
const alternative = () => ({
  id: "22222222-2222-4222-8222-222222222222", revision: 2, kind: "pro", status: "completed",
  resultAvailable: true, requires_watermark: false, is_favorite: false,
  created_at: new Date("2026-08-02T09:05:00Z"),
  config_snapshot: { style: "шале", materials: ["камень"], palette: ["земляная"], transformationLevel: "gentle" },
});
const authService = { async sessionFromRequest() { return { id: "session-e2e", user_id: "owner-e2e" }; } };
const projectService = {
  async list() { return [project()]; }, async open() { return project(); },
  async imageUrl() { return `${baseUrl}/fixture/source.svg`; },
  async saveConfiguration(_userId, _projectId, value) { configuration = value; return project(); },
  async rename() { return project(); }, async remove() { return project(); },
};
const generationService = {
  async create(_userId, _projectId, _imageId, value) { configuration = value; statusIndex = 0; return generation(); },
  async createPro(_userId, _projectId, _imageId, value) { configuration = value; return alternative(); },
  async createEdit(_userId, _projectId, parentId, value) {
    editGeneration = {
      ...alternative(), id: "33333333-3333-4333-8333-333333333333", revision: 3, kind: "edit",
      parent_generation_id: parentId, edit_scope: value.scope,
      config_snapshot: { ...alternative().config_snapshot, generationKind: "edit", editCommand: value.command },
    };
    return editGeneration;
  },
  async view(_userId, _projectId, generationId) {
    if (generationId === generation().id) { if (statusIndex < statuses.length - 1) statusIndex += 1; return generation(); }
    if (editGeneration?.id === generationId) return editGeneration;
    return alternative();
  },
  async list() { return [{ ...generation(), status: "completed", resultAvailable: true }, alternative(), ...(editGeneration ? [editGeneration] : [])]; },
  async resultUrl() { return `${baseUrl}/fixture/result.svg`; },
  async favorite(_userId, _projectId, _generationId, value) { favorite = value; return generation(); },
  async cancel() { statusIndex = 0; return { ...generation(), status: "cancelled" }; },
  async restoreVersion(_userId, _projectId, generationId) { return generationId === alternative().id ? alternative() : generation(); },
};
const walletService = {
  async summary() { return { balance: 10 }; },
  async catalog() { return { actions: [
    { code: "standard_generation", credits: 1 }, { code: "pro_generation", credits: 2 },
    { code: "text_revision", credits: 1 }, { code: "upscale_4k", credits: 1 },
  ] }; },
};
const upscaleService = {
  async create() { return { id: "upscale-e2e", status: "queued", cancellable: true }; },
  async view() { return { id: "upscale-e2e", status: "completed", output_width: 4096, output_height: 2732, resultAvailable: true }; },
  async resultUrl() { return `${baseUrl}/fixture/result.svg`; },
};
const comparisonView = () => ({
  id: "comparison-e2e", winner_generation_id: comparisonWinner, collageUrl: null,
  items: [generation(), alternative()].map((item) => ({
    generationId: item.id, revision: item.revision, kind: item.kind,
    imageUrl: `${baseUrl}/fixture/result.svg`, style: item.config_snapshot.style,
    materials: item.config_snapshot.materials, palette: item.config_snapshot.palette,
    transformationLevel: item.config_snapshot.transformationLevel, isFavorite: false,
  })),
});
const comparisonService = {
  async access() { return { allowed: true, minimumPlan: "OPTIMUM" }; },
  async create() { return comparisonView(); }, async view() { return comparisonView(); },
  async selectWinner(_userId, _projectId, _comparisonId, generationId) { comparisonWinner = generationId; return comparisonView(); },
  async favorite() { return comparisonView(); },
  async createCollage() { return { ...comparisonView(), collageUrl: `${baseUrl}/fixture/result.svg` }; },
};

const app = express();
app.get("/__health", (_request, response) => response.send("ok"));
app.post("/__reset", (_request, response) => { statusIndex = 0; favorite = false; configuration = null; editGeneration = null; comparisonWinner = null; response.sendStatus(204); });
app.get("/fixture/source.svg", (_request, response) => response.type("svg").send('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#d7d0c2"/><path d="M180 690V310L600 110l420 200v380z" fill="#9a8068"/><rect x="300" y="390" width="180" height="170" fill="#7eb0cc"/><rect x="720" y="390" width="180" height="170" fill="#7eb0cc"/></svg>'));
app.get("/fixture/result.svg", (_request, response) => response.type("svg").send('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#d9dfd7"/><path d="M180 690V310L600 110l420 200v380z" fill="#eee9df"/><path d="M180 310L600 110l420 200" stroke="#313a35" stroke-width="34" fill="none"/><rect x="300" y="390" width="180" height="170" fill="#567c91"/><rect x="720" y="390" width="180" height="170" fill="#567c91"/></svg>'));
app.use(express.json());
app.use("/assets", express.static(path.resolve("public")));
app.use("/api/projects", createProjectsRouter({ authService, projectService }));
app.use("/api/projects", createGenerationRouter({ authService, generationService }));
app.use("/api/projects", createUpscaleRouter({ authService, upscaleService }));
app.use("/api/projects", createComparisonRouter({ authService, comparisonService }));
app.use(createProjectPagesRouter({
  authService, projectService, generationService, walletService, comparisonService,
  generationConfig: { proEnabled: true, editorEnabled: true }, upscaleConfig: { enabled: true },
}));
app.listen(4173, "127.0.0.1");
