"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";

const slides = [
  {
    src: "/facade-before-bright.webp",
    mobileSrc: "/facade-before-bright-960.webp",
    title: "Исходное фото",
    details: "Дом до выбора отделки",
    alt: "Исходная фотография дома без фасадной отделки",
    duration: 2500,
  },
  {
    src: "/facade-after-bright.webp",
    mobileSrc: "/facade-after-bright-960.webp",
    title: "Современный",
    details: "Штукатурка · дерево · камень",
    alt: "Современный вариант отделки фасада этого же дома",
    duration: 1800,
  },
  {
    src: "/facade-scandinavian-bright.webp",
    mobileSrc: "/facade-scandinavian-bright-960.webp",
    title: "Скандинавский",
    details: "Фиброцемент · термодерево · камень",
    alt: "Скандинавский вариант отделки фасада этого же дома",
    duration: 1800,
  },
  {
    src: "/facade-neoclassical-bright.webp",
    mobileSrc: "/facade-neoclassical-bright-960.webp",
    title: "Неоклассика",
    details: "Штукатурка · фасадный декор · камень",
    alt: "Неоклассический вариант отделки фасада этого же дома",
    duration: 1800,
  },
] as const;

export function HeroFacadeCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const pointerStartX = useRef<number | null>(null);

  const paused = userPaused || interactionPaused || reducedMotion;
  const activeSlide = slides[activeIndex];

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReducedMotion(media.matches);

    syncPreference();
    media.addEventListener("change", syncPreference);
    return () => media.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    if (paused) return;

    const timeout = window.setTimeout(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, activeSlide.duration);

    return () => window.clearTimeout(timeout);
  }, [activeSlide.duration, paused]);

  const showPrevious = () => {
    setActiveIndex((current) => (current - 1 + slides.length) % slides.length);
  };

  const showNext = () => {
    setActiveIndex((current) => (current + 1) % slides.length);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointerStartX.current = event.clientX;
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerStartX.current === null) return;

    const distance = event.clientX - pointerStartX.current;
    pointerStartX.current = null;

    if (Math.abs(distance) < 45) return;
    if (distance > 0) showPrevious();
    else showNext();
  };

  return (
    <div
      className="heroVisual"
      id="examples"
      role="region"
      aria-roledescription="карусель"
      aria-label="Исходный дом и три варианта отделки фасада"
      onMouseEnter={() => setInteractionPaused(true)}
      onMouseLeave={() => setInteractionPaused(false)}
      onFocusCapture={() => setInteractionPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setInteractionPaused(false);
      }}
    >
      <div className="visualTop">
        <span>ПРОЕКТ 01 / ЧАСТНЫЙ ДОМ</span>
        <span className="status"><i /> ПРИМЕРЫ РЕШЕНИЙ</span>
      </div>

      <div
        className="heroCarousel"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { pointerStartX.current = null; }}
      >
        {slides.map((slide, index) => {
          const isActive = index === activeIndex;
          return (
            <div
              className={`carouselSlide${isActive ? " isActive" : ""}`}
              key={slide.src}
              aria-hidden={!isActive}
            >
              {isActive && (
                <picture>
                  <source media="(max-width: 1100px)" srcSet={slide.mobileSrc} />
                  <img
                    src={slide.src}
                    alt={slide.alt}
                    width="1568"
                    height="1003"
                    decoding="async"
                    loading={index === 0 ? "eager" : "lazy"}
                    fetchPriority={index === 0 ? "high" : "auto"}
                  />
                </picture>
              )}
            </div>
          );
        })}

        <div className="carouselShade" aria-hidden="true" />
        <div className="carouselMeta">
          <span>{activeIndex === 0 ? "ДО ОТДЕЛКИ" : `ВАРИАНТ ${activeIndex} ИЗ 3`}</span>
          <strong>{activeSlide.title}</strong>
          <small>{activeSlide.details}</small>
        </div>

        <div className="carouselControls">
          <button className="carouselArrow" type="button" onClick={showPrevious} aria-label="Предыдущий вариант">←</button>
          <div className="carouselDots" aria-label="Выбор изображения">
            {slides.map((slide, index) => (
              <button
                className={`carouselDot${index === activeIndex ? " isActive" : ""}`}
                type="button"
                key={slide.src}
                onClick={() => setActiveIndex(index)}
                aria-label={`Показать: ${slide.title}`}
                aria-current={index === activeIndex ? "true" : undefined}
              />
            ))}
          </div>
          <button className="carouselArrow" type="button" onClick={showNext} aria-label="Следующий вариант">→</button>
          <button
            className="carouselToggle"
            type="button"
            onClick={() => setUserPaused((current) => !current)}
            disabled={reducedMotion}
            aria-label={reducedMotion ? "Автоматическая смена отключена в настройках движения" : userPaused ? "Запустить смену изображений" : "Остановить смену изображений"}
          >
            {reducedMotion ? "—" : userPaused ? "▶" : "Ⅱ"}
          </button>
        </div>
      </div>

      <div className="visualBottom">
        <span><b>3</b> решения на выбор</span>
        <span>Один дом — разные стили и материалы</span>
        <span>Статус виден в кабинете</span>
      </div>
      <p className="visualFootnote">Демонстрационные примеры. Результат показывается после автоматической проверки</p>
    </div>
  );
}
