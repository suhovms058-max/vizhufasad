"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { facadeStyles } from "./facadeStyleCatalog";

const sourceImage = "/facade-before-bright.webp";

export function GalleryCases() {
  const [filter, setFilter] = useState("all");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointerStart = useRef<number | null>(null);
  const filtered = useMemo(() => filter === "all" ? facadeStyles : facadeStyles.filter((style) => style.slug === filter), [filter]);

  const move = (direction: number) => setActiveIndex((current) => {
    if (current === null || filtered.length < 2) return current;
    return (current + direction + filtered.length) % filtered.length;
  });

  useEffect(() => {
    if (activeIndex === null) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveIndex(null);
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [activeIndex, filtered.length]);

  const active = activeIndex === null ? null : filtered[activeIndex];

  return <>
    <div className="galleryFilters" role="group" aria-label="Фильтр примеров по стилю">
      <button type="button" className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => { setFilter("all"); setActiveIndex(null); }}>Все направления</button>
      {facadeStyles.map((style) => <button type="button" key={style.slug} className={filter === style.slug ? "active" : ""} aria-pressed={filter === style.slug} onClick={() => { setFilter(style.slug); setActiveIndex(null); }}>{style.title}</button>)}
    </div>
    <div className="caseGallery">
      {filtered.map((style, index) => <article className="caseCard" key={style.slug}>
        <div className="casePair">
          <figure><img src={sourceImage} alt={`Исходная фотография дома для варианта «${style.title}»`} width="1200" height="900" loading="lazy" /><figcaption>Исходник</figcaption></figure>
          <figure><img src={style.image} alt={style.imageAlt} width="1200" height="900" loading="lazy" /><figcaption>Результат</figcaption></figure>
        </div>
        <div className="caseCardBody"><p className="eyebrow">ДЕМОНСТРАЦИОННЫЙ КЕЙС</p><h3>{style.title}</h3><p>{style.summary}</p><p className="styleMeta"><strong>Материалы:</strong> {style.materials.join(", ")}</p>
          <div className="caseActions"><button type="button" className="button ghost" onClick={() => setActiveIndex(index)} data-analytics-event="gallery_case_open" data-analytics-style={style.slug}>Сравнить крупно</button><a className="textLink" href={`/styles/${style.slug}`}>Разобрать стиль →</a></div>
        </div>
      </article>)}
    </div>
    {active && <div className="caseLightbox" role="dialog" aria-modal="true" aria-labelledby="case-lightbox-title" onPointerDown={(event) => { pointerStart.current = event.clientX; }} onPointerUp={(event) => {
      if (pointerStart.current === null) return;
      const distance = event.clientX - pointerStart.current;
      pointerStart.current = null;
      if (Math.abs(distance) > 55) move(distance > 0 ? -1 : 1);
    }}>
      <div className="caseLightboxPanel">
        <div className="caseLightboxHead"><div><p className="eyebrow">ИСХОДНИК И РЕЗУЛЬТАТ</p><h2 id="case-lightbox-title">{active.title}</h2></div><button ref={closeRef} type="button" className="caseClose" aria-label="Закрыть просмотр" onClick={() => setActiveIndex(null)}>×</button></div>
        <div className="casePair casePairLarge"><figure><img src={sourceImage} alt="Исходная фотография дома" width="1200" height="900" /><figcaption>Исходник</figcaption></figure><figure><img src={active.image} alt={active.imageAlt} width="1200" height="900" /><figcaption>Результат · {active.title}</figcaption></figure></div>
        <div className="caseLightboxNav"><button type="button" className="button ghost" onClick={() => move(-1)} disabled={filtered.length < 2}>← Предыдущий</button><span>{(activeIndex ?? 0) + 1} / {filtered.length}</span><button type="button" className="button ghost" onClick={() => move(1)} disabled={filtered.length < 2}>Следующий →</button></div>
      </div>
    </div>}
  </>;
}
