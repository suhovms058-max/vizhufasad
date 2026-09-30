"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";
import { facadeStyles } from "./facadeStyleCatalog";

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>
);

const Check = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
);

const slides = [
  {
    src: "/facade-before-bright.webp",
    mobileSrc: "/facade-before-bright-960.webp",
    title: "Без отделки",
    details: "Исходная фотография дома",
    alt: "Исходная фотография дома без фасадной отделки",
    duration: 2300,
  },
  ...facadeStyles.map((style) => ({
    src: style.image,
    mobileSrc: style.slug === "sovremennyy"
      ? "/facade-after-bright-960.webp"
      : style.slug === "skandinavskiy"
        ? "/facade-scandinavian-bright-960.webp"
        : style.slug === "neoklassicheskiy"
          ? "/facade-neoclassical-bright-960.webp"
          : style.image,
    title: style.title,
    details: style.materials.slice(0, 3).join(" · "),
    alt: style.imageAlt,
    duration: 1750,
  })),
];

export function HeroFacadeCarousel({ appUrl }: { appUrl: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState(slides.length - 1);
  const [userPaused, setUserPaused] = useState(false);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const pointerStartX = useRef<number | null>(null);

  const paused = userPaused || interactionPaused || reducedMotion;
  const activeSlide = slides[activeIndex];
  const previousSlide = slides[previousIndex];

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReducedMotion(media.matches);
    syncPreference();
    media.addEventListener("change", syncPreference);
    return () => media.removeEventListener("change", syncPreference);
  }, []);

  const show = (nextIndex: number) => {
    setPreviousIndex(activeIndex);
    setActiveIndex((nextIndex + slides.length) % slides.length);
  };

  useEffect(() => {
    if (paused) return;
    const timeout = window.setTimeout(() => show(activeIndex + 1), activeSlide.duration);
    return () => window.clearTimeout(timeout);
  }, [activeIndex, activeSlide.duration, paused]);

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    pointerStartX.current = event.clientX;
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    if (pointerStartX.current === null) return;
    const distance = event.clientX - pointerStartX.current;
    pointerStartX.current = null;
    if (Math.abs(distance) < 45) return;
    show(activeIndex + (distance > 0 ? -1 : 1));
  };

  return (
    <section
      className="vf4-hero"
      id="top"
      aria-label="Один дом в десяти вариантах фасада"
      onMouseEnter={() => setInteractionPaused(true)}
      onMouseLeave={() => setInteractionPaused(false)}
      onFocusCapture={() => setInteractionPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setInteractionPaused(false);
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { pointerStartX.current = null; }}
    >
      <div className="vf4-hero-media" aria-live="polite">
        <picture className="vf4-hero-layer vf4-hero-previous" aria-hidden="true">
          <source media="(max-width: 760px)" srcSet={previousSlide.mobileSrc} />
          <img src={previousSlide.src} alt="" width="1568" height="1003" decoding="async" />
        </picture>
        <picture className="vf4-hero-layer vf4-hero-current" key={activeSlide.src}>
          <source media="(max-width: 760px)" srcSet={activeSlide.mobileSrc} />
          <img src={activeSlide.src} alt={activeSlide.alt} width="1568" height="1003" decoding="async" loading={activeIndex === 0 ? "eager" : "lazy"} fetchPriority={activeIndex === 0 ? "high" : "auto"} />
        </picture>
        <div className="vf4-hero-vignette" aria-hidden="true" />
        <div className="vf4-scan" aria-hidden="true" />
      </div>

      <div className="vf4-shell vf4-hero-inner">
        <div className="vf4-hero-copy">
          <h1>
            <span><i>Создайте дизайн</i></span>
            <span><i>фасада <strong>своего</strong></i></span>
            <span><i><strong>дома</strong> по фото</i></span>
          </h1>
          <p>Загрузите фотографию, выберите стиль, материалы и цвета. Сервис создаст визуализацию и проверит, сохранились ли окна, двери, кровля и пропорции дома.</p>
          <div className="vf4-hero-actions">
            <a className="vf4-button vf4-button-primary" href={appUrl}>Создать фасад бесплатно <Arrow /></a>
            <a className="vf4-button vf4-button-ghost" href="#proof">Посмотреть сравнение</a>
          </div>
          <div className="vf4-trust">
            <span><Check /> Первая визуализация бесплатно</span>
            <span><Check /> Автопроверка деталей дома</span>
            <span><Check /> Проекты сохраняются</span>
          </div>
        </div>

        <div className="vf4-hero-bottom">
          <div className="vf4-style-controls" aria-label="Выберите вариант фасада">
            {slides.map((slide, index) => (
              <button type="button" className="vf4-style-control" key={slide.src} aria-current={index === activeIndex ? "true" : undefined} onClick={() => show(index)}>
                {slide.title}
              </button>
            ))}
            <button type="button" className="vf4-style-control vf4-pause" onClick={() => setUserPaused((value) => !value)} disabled={reducedMotion} aria-label={userPaused ? "Продолжить автоматическую смену" : "Остановить автоматическую смену"}>
              {reducedMotion ? "Авто выключено" : userPaused ? "Продолжить" : "Пауза"}
            </button>
          </div>
          <aside className="vf4-hero-status">
            <div><small>{activeIndex === 0 ? "Исходное фото" : "Вариант на этом доме"}</small><strong>{activeSlide.title}</strong><p>{activeSlide.details}</p></div>
            <span>{String(activeIndex + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}</span>
          </aside>
        </div>
      </div>
    </section>
  );
}
