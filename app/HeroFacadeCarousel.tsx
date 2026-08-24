"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";

const slides = [
  {
    src: "/facade-before-bright.webp",
    mobileSrc: "/facade-before-bright-960.webp",
    title: "Исходное фото",
    details: "Дом до выбора отделки",
    alt: "Исходная фотография дома без фасадной отделки",
    duration: 900,
  },
  {
    src: "/facade-after-bright.webp",
    mobileSrc: "/facade-after-bright-960.webp",
    title: "Современный",
    details: "Штукатурка · дерево · камень",
    alt: "Современный вариант отделки фасада этого же дома",
    duration: 400,
  },
  {
    src: "/facade-minimalism-bright.webp",
    mobileSrc: "/facade-minimalism-bright-960.webp",
    title: "Минимализм",
    details: "Штукатурка · панели · спокойная палитра",
    alt: "Минималистичный вариант отделки фасада этого же дома",
    duration: 400,
  },
  {
    src: "/facade-scandinavian-bright.webp",
    mobileSrc: "/facade-scandinavian-bright-960.webp",
    title: "Скандинавский",
    details: "Фиброцемент · термодерево · камень",
    alt: "Скандинавский вариант отделки фасада этого же дома",
    duration: 400,
  },
  {
    src: "/facade-barnhouse-bright.webp",
    mobileSrc: "/facade-barnhouse-bright-960.webp",
    title: "Барнхаус",
    details: "Фальц · дерево · тёмные плоскости",
    alt: "Вариант отделки фасада этого же дома в стиле барнхаус",
    duration: 400,
  },
  {
    src: "/facade-chalet-bright.webp",
    mobileSrc: "/facade-chalet-bright-960.webp",
    title: "Шале",
    details: "Камень · дерево · тёплая отделка",
    alt: "Вариант отделки фасада этого же дома в стиле шале",
    duration: 400,
  },
  {
    src: "/facade-classic-bright.webp",
    mobileSrc: "/facade-classic-bright-960.webp",
    title: "Классический",
    details: "Светлая штукатурка · симметрия · декор",
    alt: "Классический вариант отделки фасада этого же дома",
    duration: 400,
  },
  {
    src: "/facade-neoclassical-bright.webp",
    mobileSrc: "/facade-neoclassical-bright-960.webp",
    title: "Неоклассика",
    details: "Штукатурка · фасадный декор · камень",
    alt: "Неоклассический вариант отделки фасада этого же дома",
    duration: 400,
  },
  {
    src: "/facade-contemporary-bright.webp",
    mobileSrc: "/facade-contemporary-bright-960.webp",
    title: "Контемпорари",
    details: "Камень · панели · выразительные детали",
    alt: "Вариант отделки фасада этого же дома в стиле контемпорари",
    duration: 400,
  },
  {
    src: "/facade-loft-bright.webp",
    mobileSrc: "/facade-loft-bright-960.webp",
    title: "Лофт",
    details: "Кирпич · металл · индустриальный характер",
    alt: "Вариант отделки фасада этого же дома в стиле лофт",
    duration: 400,
  },
  {
    src: "/facade-dark-high-tech-bright.webp",
    mobileSrc: "/facade-dark-high-tech-bright-960.webp",
    title: "Тёмный хай-тек",
    details: "Графитовые панели · стекло · точная подсветка",
    alt: "Вариант отделки фасада этого же дома в стиле тёмный хай-тек",
    duration: 400,
  },
] as const;

const finishedSlideCount = slides.length - 1;

export function HeroFacadeCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const pointerStartX = useRef<number | null>(null);

  const paused = userPaused || reducedMotion;
  const activeSlide = slides[activeIndex];

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReducedMotion(media.matches);

    syncPreference();
    media.addEventListener("change", syncPreference);
    return () => media.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    const useMobileImages = window.matchMedia("(max-width: 1100px)").matches;
    const preloaders = slides.slice(1).map((slide) => {
      const image = new Image();
      image.decoding = "async";
      image.src = useMobileImages ? slide.mobileSrc : slide.src;
      return image;
    });

    return () => preloaders.forEach((image) => { image.src = ""; });
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
      id="hero-examples"
      role="region"
      aria-roledescription="карусель"
      aria-label={`Исходный дом и ${finishedSlideCount} вариантов отделки фасада`}
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
            </div>
          );
        })}

        <div className="carouselShade" aria-hidden="true" />
        <div className="carouselMeta">
          <span>{activeIndex === 0 ? "ДО ОТДЕЛКИ" : `ВАРИАНТ ${activeIndex} ИЗ ${finishedSlideCount}`}</span>
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
        <span><b>{finishedSlideCount}</b> стилей для сравнения</span>
        <span>Один дом — разные стили и материалы</span>
        <span>Статус виден в кабинете</span>
      </div>
      <p className="visualFootnote">Демонстрационные примеры. Результат показывается после автоматической проверки</p>
    </div>
  );
}
