"use client";

import { useState } from "react";

export function FacadeComparison() {
  const [position, setPosition] = useState(50);

  return (
    <div className="vf4-compare" style={{ "--comparison": `${position}%` } as React.CSSProperties}>
      <img src="/process-house-before.webp" alt="Исходный дом без фасадной отделки" width="1536" height="1024" loading="lazy" />
      <img className="vf4-compare-after" src="/process-house-after.webp" alt="Готовый вариант фасада того же дома" width="1536" height="1024" loading="lazy" />
      <span className="vf4-compare-label vf4-before-label">Исходное фото</span>
      <span className="vf4-compare-label vf4-after-label">Вариант фасада</span>
      <div className="vf4-compare-line" aria-hidden="true" />
      <div className="vf4-compare-handle" aria-hidden="true">↔</div>
      <input type="range" min="8" max="92" value={position} onChange={(event) => setPosition(Number(event.target.value))} aria-label="Сравнить исходный дом и готовый вариант фасада" />
      <div className="vf4-proof-facts">
        <div><strong>Что сохранить</strong><span>Окна, двери, кровлю, этажность и пропорции дома — по вашему выбору.</span></div>
        <div><strong>Что изменить</strong><span>Материалы, цвет, цоколь, обрамления и декоративные акценты фасада.</span></div>
        <div><strong>Если есть ошибка</strong><span>Результат проходит проверку. При технической ошибке кредит возвращается.</span></div>
      </div>
    </div>
  );
}
