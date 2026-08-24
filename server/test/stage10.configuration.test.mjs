import assert from "node:assert/strict";
import test from "node:test";
import { ProjectService } from "../src/projects/service.mjs";

test("project configuration is normalized and persisted for reload", async () => {
  let persisted;
  const service = new ProjectService({
    repository: {
      async updateConfiguration(userId, projectId, facadeConfig, geometryPolicy) {
        persisted = { userId, projectId, facadeConfig, geometryPolicy };
        return {
          id: projectId,
          user_id: userId,
          facade_config: facadeConfig,
          geometry_policy: geometryPolicy,
        };
      },
    },
    storage: {},
    config: {},
  });
  const project = await service.saveConfiguration("owner", "project-1", {
    style: "скандинавский",
    materials: ["дерево", "фиброцемент"],
    palette: ["тёплый белый", "графит"],
    transformationLevel: "balanced",
    wishes: "Светлый фасад и тёмный цоколь",
    preserve: { plot: false, noNewFloors: true },
  });
  assert.equal(persisted.facadeConfig.style, "скандинавский");
  assert.equal(persisted.geometryPolicy.plot, false);
  assert.equal(persisted.geometryPolicy.geometry, true);
  assert.equal(persisted.geometryPolicy.windows, true);
  assert.equal(persisted.geometryPolicy.roof, true);
  assert.deepEqual(project.configuration, {
    ...persisted.facadeConfig,
    preserve: persisted.geometryPolicy,
  });
});
