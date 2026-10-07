"use client";

import { useRef, useState } from "react";
import { facadeStyles } from "./facadeStyleCatalog";

export function StyleDirectionCarousel() {
  const railRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(1);

  const move = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * Math.min(620, rail.clientWidth * 0.78), behavior: "smooth" });
  };

  const syncPosition = () => {
    const rail = railRef.current;
    if (!rail) return;
    const cards = Array.from(rail.querySelectorAll<HTMLElement>("article"));
    const railLeft = rail.getBoundingClientRect().left;
    let closest = 0;
    let distance = Number.POSITIVE_INFINITY;
    cards.forEach((card, index) => {
      const nextDistance = Math.abs(card.getBoundingClientRect().left - railLeft);
      if (nextDistance < distance) {
        closest = index;
        distance = nextDistance;
      }
    });
    setPosition(closest + 1);
  };

  return (
    <section className="vf4-catalog" id="styles">
      <div className="vf4-shell vf4-catalog-head" data-reveal>
        <h2>Найдите стиль,<br /><strong>который подойдёт вашему дому.</strong></h2>
        <p>В карусели один и тот же дом показан в десяти направлениях. Так проще сравнить характер отделки, не отвлекаясь на разную архитектуру.</p>
        <div className="vf4-carousel-actions">
          <button type="button" onClick={() => move(-1)} aria-label="Предыдущие стили">←</button>
          <button type="button" onClick={() => move(1)} aria-label="Следующие стили">→</button>
        </div>
      </div>
      <div className="vf4-style-rail" ref={railRef} onScroll={syncPosition} tabIndex={0} aria-label="Карусель стилевых направлений">
        {facadeStyles.map((style, index) => (
          <article className={index % 3 === 0 ? "vf4-style-card vf4-wide" : "vf4-style-card"} key={style.slug}>
            <img src={style.image} alt={style.imageAlt} width="1200" height="900" loading="lazy" />
            <div><small>Вариант на этом доме</small><h3>{style.title}</h3><p>{style.summary}</p></div>
          </article>
        ))}
      </div>
      <div className="vf4-shell vf4-catalog-foot">
        <p>Листайте варианты стрелками или горизонтальным движением. Здесь показано быстрое сравнение; подробные описания вынесены в отдельный каталог.</p>
        <span>{String(position).padStart(2, "0")} / {String(facadeStyles.length).padStart(2, "0")}</span>
      </div>
    </section>
  );
}
