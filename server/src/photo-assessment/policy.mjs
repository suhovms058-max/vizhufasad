const recommendationByReason = {
  resolution_below_minimum: "Снимите дом в разрешении не ниже 640×420.",
  resolution_below_recommended: "По возможности используйте фото от 1200×800 — детали фасада будут точнее.",
  extreme_underexposure: "Переснимите дом днём или при более ярком равномерном освещении.",
  low_light: "По возможности переснимите фасад при дневном свете.",
  extreme_overexposure: "Избегайте съёмки против яркого солнца и пересвеченного неба.",
  bright_exposure: "По возможности уменьшите пересвет и снимите при более мягком освещении.",
  extreme_blur_or_no_detail: "Зафиксируйте камеру и сделайте резкий снимок, на котором видны детали фасада.",
  low_detail: "По возможности сделайте более резкий снимок с различимыми окнами, дверями и кровлей.",
  not_house: "Загрузите фотографию внешнего вида частного дома.",
  interior: "Сфотографируйте дом снаружи — интерьер для визуализации фасада не подходит.",
  screenshot: "Загрузите исходную фотографию дома, а не скриншот экрана.",
  multiple_houses: "Снимите один дом так, чтобы было однозначно понятно, какой фасад нужно обработать.",
  facade_not_visible: "Снимите фасад целиком, чтобы были видны стены, окна, двери и кровля.",
  severe_obstruction: "Выберите точку съёмки, где деревья, машины или забор не закрывают большую часть фасада.",
  poor_perspective: "Отойдите дальше и снимите дом более прямо, без сильного наклона камеры.",
  blurred: "Сделайте более резкий снимок и не двигайте камеру во время съёмки.",
  too_dark: "Переснимите фасад днём или при хорошем равномерном освещении.",
  too_bright: "Переснимите без сильного пересвета и прямого солнца в объектив.",
  roof_cropped: "Включите в кадр крышу целиком и оставьте немного пространства над ней.",
  house_cropped: "Поместите дом в кадр целиком, не обрезая стены и основные границы.",
  low_confidence: "Сделайте более прямой и полный снимок одного фасада при хорошем освещении.",
};

function unique(values) {
  return [...new Set(values)];
}

export function decidePhotoAssessment(technical, observation) {
  const blocking = [...technical.blocking];
  const warnings = [...technical.warnings];
  const issues = new Set(observation.issueCodes);

  if (!observation.houseVisible || observation.scene === "other") blocking.push("not_house");
  if (observation.scene === "interior") blocking.push("interior");
  if (observation.scene === "screenshot") blocking.push("screenshot");
  if (observation.scene === "multiple_houses") blocking.push("multiple_houses");
  if (!observation.facadeVisible) blocking.push("facade_not_visible");
  if (observation.frameCompleteness === "major_crop") blocking.push("house_cropped");
  else if (observation.frameCompleteness === "minor_crop") warnings.push("house_cropped");
  if (observation.roofCrop === "major") blocking.push("roof_cropped");
  else if (observation.roofCrop === "minor") warnings.push("roof_cropped");
  if (observation.geometry === "poor") blocking.push("facade_not_visible");
  else if (observation.geometry === "acceptable") warnings.push("low_detail");
  if (observation.obstruction === "major") blocking.push("severe_obstruction");
  else if (observation.obstruction === "minor") warnings.push("severe_obstruction");
  if (observation.perspective === "poor") blocking.push("poor_perspective");
  else if (observation.perspective === "acceptable") warnings.push("poor_perspective");
  if (observation.sharpness === "poor") blocking.push("blurred");
  else if (observation.sharpness === "acceptable") warnings.push("blurred");
  if (observation.lighting === "poor") {
    blocking.push(issues.has("too_bright") ? "too_bright" : "too_dark");
  } else if (observation.lighting === "acceptable") {
    warnings.push(issues.has("too_bright") ? "too_bright" : "too_dark");
  }
  if (observation.confidence < 0.6) blocking.push("low_confidence");

  const blockingReasons = unique(blocking);
  const warningReasons = unique(warnings).filter((reason) => !blockingReasons.includes(reason));
  const ignoredIssueCodes = [...issues].filter(
    (issue) => !blockingReasons.includes(issue) && !warningReasons.includes(issue),
  );
  const decision = blockingReasons.length
    ? "retake_required"
    : warningReasons.length || observation.confidence < 0.82
      ? "accepted_with_warning"
      : "accepted";
  const reasons = decision === "retake_required" ? blockingReasons : warningReasons;
  const recommendations = unique(reasons.map((reason) => recommendationByReason[reason]).filter(Boolean));
  const userResult = {
    decision,
    title: decision === "accepted"
      ? "Фото подходит"
      : decision === "accepted_with_warning"
        ? "Фото подходит с замечаниями"
        : "Нужно переснять фото",
    summary: decision === "accepted"
      ? "Фасад и геометрия дома читаются достаточно хорошо для следующего шага."
      : decision === "accepted_with_warning"
        ? "Можно продолжить, но более качественный снимок повысит точность визуализации."
        : "Текущий кадр не позволяет надёжно сохранить геометрию дома при визуализации.",
    recommendations,
  };
  return {
    decision,
    technicalResult: {
      sharp: technical,
      observation,
      policy: {
        version: "facade-photo-policy-v2",
        acceptedConfidence: 0.82,
        minimumConfidence: 0.6,
        blockingReasons,
        warningReasons,
        ignoredIssueCodes,
      },
    },
    userResult,
  };
}
