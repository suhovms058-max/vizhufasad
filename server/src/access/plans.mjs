export const PLAN_ACCESS = Object.freeze({
  START: Object.freeze({
    code: "START",
    label: "Старт",
    styles: Object.freeze(["автоподбор", "современный", "скандинавский", "неоклассический", "минимализм"]),
    materials: Object.freeze(["автоподбор", "штукатурка", "дерево", "фиброцемент", "комбинированная", "панели"]),
    pro: false,
    comparison: false,
    editor: false,
    upscale: false,
  }),
  OPTIMUM: Object.freeze({
    code: "OPTIMUM",
    label: "Оптимум",
    styles: Object.freeze([
      "автоподбор", "современный", "скандинавский", "неоклассический",
      "минимализм", "барнхаус", "шале", "классический",
    ]),
    materials: Object.freeze([
      "автоподбор", "штукатурка", "дерево", "фиброцемент", "комбинированная",
      "кирпич", "клинкер", "камень", "панели",
    ]),
    pro: true,
    comparison: true,
    editor: false,
    upscale: false,
  }),
  MAXIMUM: Object.freeze({
    code: "MAXIMUM",
    label: "Максимум",
    styles: Object.freeze([
      "автоподбор", "современный", "скандинавский", "неоклассический",
      "минимализм", "барнхаус", "шале", "классический", "контемпорари",
      "лофт", "тёмный хай-тек",
    ]),
    materials: Object.freeze([
      "автоподбор", "штукатурка", "дерево", "фиброцемент", "комбинированная",
      "кирпич", "клинкер", "камень", "панели", "металл",
    ]),
    pro: true,
    comparison: true,
    editor: true,
    upscale: true,
  }),
});

// Бесплатный результат и точечные пополнения используют возможности «Старта».
// Покупка TOPUP_* меняет баланс, но не повышает уровень пакета.
export function accessForPlan(code) {
  const normalized = String(code || "START").toUpperCase();
  return PLAN_ACCESS[normalized === "PLUS" ? "OPTIMUM" : normalized] || PLAN_ACCESS.START;
}

export class PlanAccessService {
  constructor(repository) { this.repository = repository; }

  async forUser(userId) {
    return accessForPlan(await this.repository.highestPaidPackage(userId));
  }

  async assertGeneration(userId, kind, input) {
    const access = await this.forUser(userId);
    if (kind === "pro" && !access.pro) return { allowed: false, code: "PRO_PLAN_REQUIRED", access };
    if (kind === "edit" && !access.editor) return { allowed: false, code: "EDIT_PLAN_REQUIRED", access };
    if (!access.styles.includes(input.style)) return { allowed: false, code: "PLAN_STYLE_REQUIRED", access };
    const unavailable = (input.materials || []).filter((material) => !access.materials.includes(material));
    if (unavailable.length) return { allowed: false, code: "PLAN_MATERIAL_REQUIRED", access };
    return { allowed: true, access };
  }
}
