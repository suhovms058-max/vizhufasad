"use client";

import { useEffect, useState } from "react";
import { FacadeComparison } from "./FacadeComparison";
import { HeroFacadeCarousel } from "./HeroFacadeCarousel";
import { JsonLd } from "./JsonLd";
import { StyleDirectionCarousel } from "./StyleDirectionCarousel";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "/app/new";
const CABINET_URL = "/app";
const CATALOG_URL = process.env.NEXT_PUBLIC_CATALOG_URL || "/api/public/catalog";
const PAYMENTS_ENABLED = process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === "true";
const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://vizhufasad.ru";

type PublicTariff = { code: string; priceMinor: number; credits: number };
type PublicAction = { code: string; credits: number };

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>
);

const faqs = [
  ["Нужно заранее знать названия материалов?", "Нет. Можно выбрать готовое стилевое направление, включить автоподбор или указать только желаемые цвета и детали."],
  ["Форма дома, окна и крыша изменятся?", "Задача сервиса — сохранить геометрию, окна, двери, кровлю и этажность. Перед запуском можно отдельно отметить элементы, которые нельзя менять."],
  ["Какое фото подойдёт?", "Снимок при дневном свете, где дом виден целиком и не перекрыт деревьями или автомобилями. Лучше снимать прямо или под небольшим углом."],
  ["Что будет, если результат исказит дом?", "Результат проходит автоматическую проверку. Сервис делает бесплатный повтор, а если он тоже не проходит проверку — возвращает кредит."],
  ["Где хранятся фотографии?", "После отдельного согласия снимок загружается в приватное хранилище и доступен только внутри вашего проекта по временной защищённой ссылке."],
  ["Это готовый строительный проект?", "Нет. Это визуальный способ выбрать направление фасада до покупки материалов. Чертежи, расчёты и спецификации готовит профильный специалист."],
];

export default function HomePage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [publicCatalog, setPublicCatalog] = useState<{ tariffs: PublicTariff[]; actions: PublicAction[] } | null>(null);

  useEffect(() => {
    const updateHeader = () => setScrolled(window.scrollY > 40);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });

    const reveal = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("vf4-visible");
          reveal.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14 });
    document.querySelectorAll("[data-reveal]").forEach((element) => reveal.observe(element));

    return () => {
      window.removeEventListener("scroll", updateHeader);
      reveal.disconnect();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(CATALOG_URL, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("CATALOG_UNAVAILABLE")))
      .then((value) => setPublicCatalog(value))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const tariff = (code: string, priceMinor: number, credits: number) =>
    publicCatalog?.tariffs.find((item) => item.code === code) || { code, priceMinor, credits };
  const standardCost = publicCatalog?.actions.find((item) => item.code === "standard_generation")?.credits || 1;
  const plans = [
    { id: "FREE", name: "Бесплатно", description: "Посмотрите один вариант своего дома", fallbackPrice: 0, fallbackCredits: 1, className: "", button: "Начать бесплатно" },
    { id: "START", name: "Старт", description: "Для нескольких вариантов одного дома", fallbackPrice: 79_000, fallbackCredits: 4, className: "vf4-recommended", button: "Выбрать Старт" },
    { id: "OPTIMUM", name: "Оптимум", description: "Для сравнения нескольких направлений", fallbackPrice: 129_000, fallbackCredits: 8, className: "", button: "Выбрать Оптимум" },
    { id: "MAXIMUM", name: "Максимум", description: "Для серии вариантов или нескольких домов", fallbackPrice: 349_000, fallbackCredits: 25, className: "", button: "Выбрать Максимум" },
  ].map((plan) => ({ ...plan, tariff: tariff(plan.id, plan.fallbackPrice, plan.fallbackCredits) }));
  const rubles = (minor: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(minor / 100) + " ₽";

  return (
    <main className="vf4-page">
      <header className={scrolled ? "vf4-header vf4-scrolled" : "vf4-header"}>
        <a className="vf4-brand" href="#top" aria-label="ВИЖУФАСАД — главная">
          <span className="vf4-brand-mark">ВФ</span>
          <span>ВИЖУФАСАД<small>AI-ВИЗУАЛИЗАЦИЯ ФАСАДОВ</small></span>
        </a>
        <div className="vf4-nav-wrap">
          <nav aria-label="Главное меню">
            <a href="#top">Главная</a><a href="#flow">Как это работает</a><a href="#styles">Стили</a><a href="#pricing">Тарифы</a><a href="#faq">Вопросы</a>
          </nav>
          <a className="vf4-login" href={CABINET_URL}>Войти</a>
          <a className="vf4-header-cta" href={APP_URL}>Создать проект <Arrow /></a>
        </div>
      </header>

      <HeroFacadeCarousel appUrl={APP_URL} />

      <section className="vf4-proof" id="proof">
        <div className="vf4-shell">
          <div className="vf4-section-head" data-reveal>
            <h2>Меняем отделку.<br /><strong>Дом остаётся узнаваемым.</strong></h2>
            <p>Перед запуском отметьте, что нужно сохранить: форму и этажность дома, окна, двери и кровлю. Затем сравните исходную фотографию и готовый вариант на одном экране.</p>
          </div>
          <div data-reveal><FacadeComparison /></div>
        </div>
      </section>

      <section className="vf4-flow" id="flow">
        <div className="vf4-shell">
          <div className="vf4-section-head" data-reveal>
            <h2>От фотографии<br /><strong>до готового варианта.</strong></h2>
            <p>Весь путь проходит внутри одного проекта. Исходник, выбранные настройки и результаты сохраняются в личном кабинете — к ним можно вернуться позже.</p>
          </div>
          <div className="vf4-flow-list" data-reveal>
            {[
              ["01", "Создайте проект", "Войдите по email и откройте новый проект. Никаких анкет и звонков."],
              ["02", "Добавьте фотографию", "Сервис проверит, достаточно ли хорошо виден дом для визуализации."],
              ["03", "Задайте изменения", "Выберите стиль, материалы и элементы дома, которые нельзя менять."],
              ["04", "Сравните и сохраните", "Посмотрите результат рядом с исходником, скачайте его или создайте новый вариант."],
            ].map(([number, title, text]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p><Arrow /></article>)}
          </div>
        </div>
      </section>

      <section className="vf4-story" aria-label="Почему варианты показаны на одном доме">
        <img src="/facade-dark-high-tech-bright.webp" alt="Тёмный хай-тек на том же демонстрационном доме" width="1200" height="900" loading="lazy" />
        <div className="vf4-shell vf4-story-copy" data-reveal><h2>Один дом.<strong>Десять вариантов отделки.</strong></h2><p>Одинаковый ракурс помогает сравнивать именно фасад: материалы, цвет и характер стиля — без влияния другой архитектуры или участка.</p></div>
      </section>

      <StyleDirectionCarousel />

      <section className="vf4-style-directory">
        <div className="vf4-shell" data-reveal>
          <h2>Хотите разобраться в стилях подробнее?</h2>
          <p>В отдельном каталоге собраны 10 подробных разборов: характерные материалы, цветовые палитры, особенности направления и пример на одном доме.</p>
          <a className="vf4-button vf4-button-primary" href="/styles">Открыть каталог стилей <Arrow /></a>
        </div>
      </section>

      <section className="vf4-pricing" id="pricing">
        <div className="vf4-pricing-visual">
          <div className="vf4-shell vf4-section-head" data-reveal>
            <h2>Начните бесплатно.<br /><strong>Выбирайте пакет, когда нужно.</strong></h2>
            <p>Один стандартный вариант фасада стоит {standardCost} кредит. Проверка фотографии и скачивание результата бесплатны. Кредиты можно докупить в личном кабинете в любое время.</p>
          </div>
        </div>
        <div className="vf4-shell">
          <div className="vf4-pricing-grid" data-reveal>
            {plans.map((plan) => {
              const variants = Math.floor(plan.tariff.credits / standardCost);
              return <article className={`vf4-price-card ${plan.className}`} key={plan.id}>
                {plan.id === "START" && <span className="vf4-popular">Чаще выбирают</span>}
                <small>{plan.description}</small><h3>{plan.name}</h3>
                <p className="vf4-price"><strong>{rubles(plan.tariff.priceMinor)}</strong>{plan.tariff.credits} {plan.tariff.credits === 1 ? "кредит" : "кредитов"}</p>
                <ul><li>До {variants} стандартных вариантов</li><li>Автоматическая проверка результата</li><li>{plan.id === "FREE" ? "Результат с водяным знаком" : "История проекта в кабинете"}</li></ul>
                <a className={plan.id === "START" ? "vf4-button vf4-button-primary" : "vf4-button vf4-button-ghost"} href={plan.id === "FREE" ? APP_URL : CABINET_URL}>{plan.button}</a>
              </article>;
            })}
          </div>
          <p className="vf4-pricing-note">{PAYMENTS_ENABLED ? "Кредиты приобретаются разово в личном кабинете. Подписки, автопродление и автоматические списания отключены." : "Оплата временно выключена и не показывается в кабинете."} При технической ошибке кредит возвращается автоматически.</p>
        </div>
      </section>

      <section className="vf4-objections">
        <div className="vf4-shell vf4-objection-grid">
          <h2 data-reveal>До визуализации<br /><strong>важно знать.</strong></h2>
          <div data-reveal>
            <article><strong>Это визуальная концепция, а не строительный проект</strong><p>Сервис помогает выбрать направление отделки. Чертежи, смету и точную спецификацию материалов готовит профильный специалист.</p></article>
            <article><strong>Оттенок на экране может отличаться от материала</strong><p>Цвет зависит от производителя, освещения и экрана. Перед покупкой проверьте материал по физическому образцу.</p></article>
            <article><strong>Фотография остаётся внутри вашего проекта</strong><p>Исходник загружается после отдельного согласия и хранится в приватном доступе.</p></article>
          </div>
        </div>
      </section>

      <section className="vf4-faq" id="faq">
        <div className="vf4-shell vf4-faq-grid">
          <h2 data-reveal>Часто задаваемые вопросы<br /><strong>о визуализации фасада.</strong></h2>
          <div className="vf4-faq-list" data-reveal>
            {faqs.map(([question, answer], index) => <button type="button" className={openFaq === index ? "vf4-faq-item vf4-open" : "vf4-faq-item"} key={question} onClick={() => setOpenFaq(openFaq === index ? null : index)} aria-expanded={openFaq === index}>
              <span className="vf4-faq-question"><b>{String(index + 1).padStart(2, "0")}</b><strong>{question}</strong><i>{openFaq === index ? "−" : "+"}</i></span>
              <span className="vf4-faq-answer"><span>{answer}</span></span>
            </button>)}
          </div>
        </div>
      </section>

      <section className="vf4-closing">
        <div className="vf4-shell" data-reveal><h2>Посмотрите,<br /><strong>каким может стать ваш дом.</strong></h2><p>Создайте проект, загрузите фотографию и получите первую визуализацию фасада бесплатно. Исходник, настройки и результат сохранятся в личном кабинете.</p><div><a className="vf4-button vf4-button-primary" href={APP_URL}>Создать фасад бесплатно <Arrow /></a><a className="vf4-button vf4-button-ghost" href="/styles">Открыть каталог стилей</a></div></div>
      </section>

      <footer className="vf4-footer">
        <div className="vf4-shell">
          <div className="vf4-footer-top"><div><a className="vf4-brand" href="#top"><span className="vf4-brand-mark">ВФ</span><span>ВИЖУФАСАД<small>AI-ВИЗУАЛИЗАЦИЯ ФАСАДОВ</small></span></a><p>Визуализация вариантов отделки частных домов и строений по всей России.</p></div><div className="vf4-footer-links"><div><strong>Продукт</strong><a href="#flow">Как это работает</a><a href="#pricing">Тарифы</a><a href="/gallery">Примеры</a><a href="/styles">Каталог стилей</a></div><div><strong>Полезное</strong><a href="/visualizaciya-fasada-po-foto">Фасад по фото</a><a href="/stili-i-materialy-fasada">Стили и материалы</a><a href="/partners">Партнёрам</a><a href="#faq">Вопросы</a></div><div><strong>Информация</strong><a href="/legal/offer">Условия оплаты</a><a href="/legal/privacy">Конфиденциальность</a><a href="/legal/refunds">Возвраты</a><a href="mailto:vizhufasad0058@bk.ru">vizhufasad0058@bk.ru</a></div></div></div>
          <div className="vf4-footer-bottom"><span>© 2026 ВИЖУФАСАД · Условия цифровой услуги опубликованы в публичной оферте</span><span>Результат является визуальной концепцией фасада, а не строительным проектом, сметой или точным расчётом материалов.</span></div>
        </div>
      </footer>

      <JsonLd data={{ "@context": "https://schema.org", "@type": "SoftwareApplication", "@id": `${SITE_ORIGIN}/#webapp`, name: "ВИЖУФАСАД", url: SITE_ORIGIN, applicationCategory: "DesignApplication", operatingSystem: "Web", description: "Автоматическая визуализация вариантов фасада дома по фотографии с выбором стиля, материалов и цвета.", offers: { "@type": "Offer", price: "0", priceCurrency: "RUB", description: "Одна пробная визуализация фасада с водяным знаком" }, provider: { "@id": `${SITE_ORIGIN}/#organization` } }} />
      <JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) }} />
    </main>
  );
}
