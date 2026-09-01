"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { HeroFacadeCarousel } from "./HeroFacadeCarousel";
import { LandingPhotoCheck } from "./LandingPhotoCheck";
import { JsonLd } from "./JsonLd";

const LEADS_API =
  process.env.NEXT_PUBLIC_LEADS_API_URL ||
  "/api/leads";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "/app/new";
const LEGACY_LEADS_ENABLED = process.env.NEXT_PUBLIC_LEGACY_LEADS_ENABLED === "true";
const PAYMENTS_ENABLED = process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === "true";
const CATALOG_URL = process.env.NEXT_PUBLIC_CATALOG_URL || "/api/public/catalog";
const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://vizhufasad.ru";

type PublicTariff = { code: string; priceMinor: number; credits: number };
type PublicAction = { code: string; credits: number };

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

const Check = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
);

const UploadIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5" /></svg>
);

type PackageId = "trial" | "visual" | "selection" | "realization";

const packageNames: Record<PackageId, string> = {
  trial: "Бесплатный",
  visual: "Старт",
  selection: "Оптимум",
  realization: "Максимум",
};

const packageCodes: Partial<Record<PackageId, "START" | "OPTIMUM" | "MAXIMUM">> = {
  visual: "START",
  selection: "OPTIMUM",
  realization: "MAXIMUM",
};

const faqs = [
  ["Что происходит после бесплатной генерации?", "Готовый первый вариант остаётся в вашем проекте. Если захотите сравнить другие стили, можно выбрать пакет для нескольких генераций или добавить в кабинете 1–3 ВФ-коина."],
  ["Нужно ли знать названия материалов?", "Нет. Можно выбрать автоподбор или отметить желаемые материалы и цвета самостоятельно."],
  ["Изменится ли форма дома?", "Наша задача — сохранить геометрию, окна, двери и кровлю. Визуализация показывает отделку, а не придумывает другое здание."],
  ["Какое фото подойдёт?", "Снимите дом днём и постарайтесь показать фасад целиком. Временные предметы, стройматериалы и незначительные препятствия допустимы, если хорошо видны стены, окна, двери и кровля."],
  ["Где хранится загруженная фотография?", "После отдельного согласия исходник хранится приватно в российском хранилище. На сервере удаляются метаданные и маскируются найденные лица, номера и текстовые данные. Документ или снимок с большим количеством текста отклоняется. Только отдельная очищенная копия передаётся AI через GenAPI. Если защита завершилась ошибкой, передача и генерация блокируются. Файлы удаляются вместе с проектом или аккаунтом с учётом технического срока очистки."],
  ["Что произойдёт, если генерация исказит дом?", "Результат проходит автоматическую проверку. При грубом изменении выполняется одна бесплатная повторная попытка, а после второй неудачи ВФ-коин возвращается и брак не показывается."],
  ["Что может отличаться от будущей отделки?", "Оттенок и фактура реального материала зависят от производителя, освещения и экрана. Мелкий декор и детали участка тоже могут отличаться: сервис помогает выбрать визуальное направление, а не фиксирует строительную спецификацию."],
  ["Когда списывается ВФ-коин и что будет при технической ошибке?", "Перед запуском действия ВФ-коин резервируется один раз. После успешного результата списание подтверждается, а при технической неудаче или окончательном отклонении автоматической проверкой ВФ-коин возвращается автоматически. Повторный запрос не создаёт двойного списания или возврата."],
  ["Можно ли описать свои пожелания?", "Да. В мастере проекта можно указать материалы, цвета, отделку карниза, цоколя и существующих опор. Пожелания автоматически входят в задание генератору."],
  ["Это строительный проект?", "Нет. Результат — концепция внешнего вида фасада, а не чертёж, смета или инструкция для строителей."],
];

export default function App() {
  const [modal, setModal] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<PackageId>("trial");
  const [preview, setPreview] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [sent, setSent] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [wishes, setWishes] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [orderId, setOrderId] = useState("");
  const [photoQuality, setPhotoQuality] = useState("");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [activeProcessStep, setActiveProcessStep] = useState(0);
  const processStepsRef = useRef<HTMLDivElement | null>(null);
  const [publicCatalog, setPublicCatalog] = useState<{ tariffs: PublicTariff[]; actions: PublicAction[] } | null>(null);

  useEffect(() => {
    document.body.style.overflow = modal || videoOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [modal, videoOpen]);

  useEffect(() => {
    if (!videoOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVideoOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [videoOpen]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(CATALOG_URL, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("CATALOG_UNAVAILABLE")))
      .then((value) => setPublicCatalog(value))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const startOrder = (id: PackageId) => {
    if (!LEGACY_LEADS_ENABLED) {
      const packageCode = packageCodes[id];
      window.location.assign(packageCode ? `/app/balance?plan=${packageCode}#plan-${packageCode}` : APP_URL);
      return;
    }
    setSelectedPackage(id);
    setStep(1);
    setSent(false);
    setSubmitError("");
    setOrderId("");
    setPhotoQuality("");
    setModal(true);
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setSubmitError("Фото должно быть не больше 15 МБ");
      event.target.value = "";
      return;
    }
    setSubmitError("");
    setPhoto(file);
    setFileName(file.name);
    setPreview(URL.createObjectURL(file));
  };

  const submit = async () => {
    if (!photo || !name.trim() || !contact.trim() || !consent) {
      setSubmitError("Заполните имя и контакт, подтвердите согласие");
      return;
    }

    setSending(true);
    setSubmitError("");
    const data = new FormData();
    data.append("photo", photo);
    data.append("name", name.trim());
    data.append("contact", contact.trim());
    data.append("wishes", wishes.trim());
    data.append("package", packageNames[selectedPackage]);

    try {
      const response = await fetch(LEADS_API, { method: "POST", body: data });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Не удалось отправить заявку");
      setOrderId(result?.orderId || "");
      setPhotoQuality(result?.ai?.customerMessage || result?.quality?.label || "Фото принято на проверку");
      setSent(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Не удалось отправить заявку. Попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  };

  const tariff = (code: string, priceMinor: number, credits: number) =>
    publicCatalog?.tariffs.find((item) => item.code === code) || { code, priceMinor, credits };
  const standardCost = publicCatalog?.actions.find((item) => item.code === "standard_generation")?.credits || 1;
  const freePlan = tariff("FREE", 0, 1);
  const startPlan = tariff("START", 79_000, 4);
  const optimumPlan = tariff("OPTIMUM", 129_000, 8);
  const maximumPlan = tariff("MAXIMUM", 349_000, 25);
  const rubles = (minor: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(minor / 100) + " ₽";
  const ordinaryGenerations = (plan: PublicTariff) => Math.floor(plan.credits / standardCost);
  const generationLimitLabel = (amount: number) => {
    const mod100 = amount % 100;
    const mod10 = amount % 10;
    const noun = mod10 === 1 && !(mod100 >= 11 && mod100 <= 14) ? "генерации" : "генераций";
    return `${amount} ${noun}`;
  };
  const vfCoinsLabel = (amount: number) => {
    const mod100 = amount % 100;
    const mod10 = amount % 10;
    const noun = mod100 >= 11 && mod100 <= 14
      ? "ВФ-коинов"
      : mod10 === 1 ? "ВФ-коин" : mod10 >= 2 && mod10 <= 4 ? "ВФ-коина" : "ВФ-коинов";
    return `${amount} ${noun}`;
  };
  const showProcessStep = (index: number) => {
    const container = processStepsRef.current;
    const target = container?.children[index] as HTMLElement | undefined;
    if (!container || !target) return;
    container.scrollTo({ left: target.offsetLeft, behavior: "smooth" });
    setActiveProcessStep(index);
  };
  const syncProcessStep = () => {
    const container = processStepsRef.current;
    if (!container) return;
    const cards = Array.from(container.children) as HTMLElement[];
    const nearest = cards.reduce((best, card, index) =>
      Math.abs(card.offsetLeft - container.scrollLeft) < Math.abs(cards[best].offsetLeft - container.scrollLeft) ? index : best, 0);
    setActiveProcessStep(nearest);
  };

  return (
    <main>
      <header className="header shell">
        <a className="logo" href="#top" aria-label="ВИЖУФАСАД — главная">
          <span className="logoMark">ВФ</span>
          <span>ВИЖУФАСАД<small>ВИЗУАЛИЗАЦИЯ ФАСАДОВ ПО ФОТО</small></span>
        </a>
        <nav aria-label="Главное меню">
          <a href="#how">Как это работает</a>
          <a href="#pricing">Тарифы</a>
          <a href="#examples">Примеры</a>
          <a href="#faq">Вопросы</a>
        </nav>
      </header>

      <section className="hero shell" id="top">
        <div className="heroCopy">
          <div className="eyebrow"><span /> ДИЗАЙН ФАСАДА ПО ФОТОГРАФИИ</div>
          <h1>Создайте дизайн фасада своего дома <em>с помощью ИИ</em> по фотографии</h1>
          <p>Загрузите фотографию, выберите стиль, материалы и цвета. Сервис создаст визуализацию и автоматически проверит, сохранились ли окна, двери, кровля и пропорции дома.</p>
          <div className="heroOffer">
            <strong>Первая визуализация фасада — бесплатно</strong>
            <span>Без оплаты и привязки карты. После результата можно выбрать пакет или добавить отдельные ВФ-коины.</span>
          </div>
          <div className="heroActions">
            <a className="button primary" href="#photo-check" data-analytics-event="hero_cta" data-analytics-placement="hero">Создать фасад бесплатно <Arrow /></a>
            <a className="textLink" href="#examples">Посмотреть примеры <Arrow /></a>
          </div>
          <div className="microTrust">
            <span><Check /> Без привязки карты</span>
            <span><Check /> Автопроверка окон, дверей и кровли</span>
            <span><Check /> Фото хранится приватно</span>
          </div>
          <p className="conceptNote">Визуальная концепция, а не строительный проект или расчёт материалов.</p>
        </div>

        <HeroFacadeCarousel />
      </section>

      <section className="signal">
        <div className="shell signalGrid">
          <p>Не выбирайте отделку<br /><i>вслепую.</i></p>
          <div><strong>1 фото</strong><span>достаточно для старта</span></div>
          <div><strong>0 ₽</strong><span>за первый вариант</span></div>
          <div><strong>3 шага</strong><span>от фото до концепции</span></div>
        </div>
      </section>

      <section className="processShowcase section" id="how" aria-labelledby="process-title">
        <div className="processGlow" aria-hidden="true" />
        <div className="shell processLayout">
          <div className="processIntro">
            <div>
              <div className="eyebrow light"><span /> ПРОСТОЙ ПУТЬ К РЕЗУЛЬТАТУ</div>
              <h2 id="process-title">От фотографии<br />до концепции фасада<br /><em>за 3 шага</em></h2>
            </div>
            <div className="processIntroText">
              <p>Мы убрали из процесса всё сложное. Вы показываете дом и выбираете направление отделки. Остальное делает сервис.</p>
              <div className="processIntroActions">
                <a className="button primary" href="#photo-check" data-analytics-event="hero_cta" data-analytics-placement="process">Создать первый фасад <Arrow /></a>
                <div className="processVideoTrigger">
                  <button className="processVideoLink" type="button" onClick={() => setVideoOpen(true)} aria-haspopup="dialog">
                    <span className="processVideoPlay" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 7 8 5-8 5Z" /></svg></span>
                    <span><strong>Посмотреть видеоинструкцию</strong><small>3 минуты</small></span>
                  </button>
                  <span className="processVideoPreview" aria-hidden="true">
                    <img src="/vizhufasad-video-instruction-with-styles-poster.jpg" alt="" width="1280" height="720" loading="lazy" decoding="async" />
                    <i><span>▶</span> Как работает ВИЖУФАСАД</i>
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="processCarousel">
            <button className="processCarouselArrow processCarouselArrowPrev" type="button" onClick={() => showProcessStep(Math.max(0, activeProcessStep - 1))} disabled={activeProcessStep === 0} aria-label="Предыдущий шаг"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg></button>
            <div className="processSteps" ref={processStepsRef} onScroll={syncProcessStep} aria-label="Три шага визуализации фасада дома по фотографии">
            <article className="processStep processCapture">
              <div className="processMedia">
                <picture className="processPicture">
                  <source media="(max-width: 1100px)" srcSet="/process-house-before-960.webp" />
                  <img src="/process-house-before.webp" alt="Современный двухэтажный дом до отделки фасада — исходная фотография для визуализации" width="1536" height="1024" loading="lazy" decoding="async" />
                </picture>
                <div className="processPhone" aria-hidden="true">
                  <span />
                  <img src="/process-house-before-960.webp" alt="" width="960" height="640" loading="lazy" decoding="async" />
                  <i />
                </div>
                <span className="processNumber">01</span>
                <span className="processArrow" aria-hidden="true">→</span>
              </div>
              <div className="processBody">
                <h3>Загрузите фото</h3>
                <p>Снимок дома с телефона — целиком и при дневном свете. Временные предметы допустимы, если фасад хорошо виден.</p>
              </div>
            </article>
            <article className="processStep processChoice">
              <div className="processMedia processReferenceMedia">
                <img src="/process-step-materials.webp" alt="Коллаж выбора отделки фасада: дерево, штукатурка, камень, палитра цветов и архитектурный эскиз" width="366" height="620" loading="lazy" decoding="async" />
              </div>
              <div className="processBody">
                <h3>Выберите стиль и материалы</h3>
                <p>Современный, классический, скандинавский стиль или своё сочетание материалов и цветов.</p>
              </div>
            </article>
            <article className="processStep processResult">
              <div className="processMedia">
                <picture className="processPicture">
                  <source media="(max-width: 1100px)" srcSet="/process-house-after-960.webp" />
                  <img src="/process-house-after.webp" alt="Тот же современный дом с готовой отделкой из камня и дерева и сохранённой геометрией" width="1536" height="1024" loading="lazy" decoding="async" />
                </picture>
                <div className="processBeforeInset" aria-hidden="true">
                  <img src="/process-house-before-960.webp" alt="" width="960" height="640" loading="lazy" decoding="async" />
                </div>
                <span className="processNumber">03</span>
                <span className="processArrow" aria-hidden="true">→</span>
                <span className="processReady"><Check /> ПРОВЕРЕНО</span>
              </div>
              <div className="processBody">
                <h3>Получите проверенную визуализацию</h3>
                <p>Сравните результат с исходной фотографией и выберите направление отделки для своего дома.</p>
              </div>
            </article>
          </div>
            <button className="processCarouselArrow processCarouselArrowNext" type="button" onClick={() => showProcessStep(Math.min(2, activeProcessStep + 1))} disabled={activeProcessStep === 2} aria-label="Следующий шаг"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6" /></svg></button>
        </div>
        </div>
      </section>

      <section className="deliver section">
        <div className="shell deliverGrid">
          <div className="deliverVisual">
            <img src="/facade-styles/shale-01.webp" alt="Одноэтажный дом в стиле шале с отделкой камнем, деревом и минеральной штукатуркой" />
            <div className="materialCard"><span>МАТЕРИАЛЫ</span><strong>Камень<br />и дерево</strong><small>Минеральная штукатурка</small></div>
          </div>
          <div className="deliverCopy">
            <div className="eyebrow"><span /> НЕ ПРОСТО КРАСИВАЯ КАРТИНКА</div>
            <h2>Концепция, с которой<br />проще <em>выбрать отделку</em></h2>
            <p className="lead">ИИ учитывает выбранный стиль, материалы и цвета, сохраняет защищённую геометрию дома и автоматически проверяет результат.</p>
            <ul>
              <li><Check /><span><strong>Автоматическая проверка</strong>ИИ сверяет окна, двери, кровлю и пропорции с исходной фотографией.</span></li>
              <li><Check /><span><strong>Настройки пользователя</strong>Стиль, отделка, палитра и ограничения входят в задание генератору.</span></li>
              <li><Check /><span><strong>Только проверенный результат</strong>При грубом изменении дома выполняется автоматический повтор или возврат ВФ-коина.</span></li>
            </ul>
            <a className="textLink" href="#photo-check">Создать бесплатный вариант <Arrow /></a>
          </div>
        </div>
      </section>

      <section className="stylePreview section" id="examples">
        <div className="shell compactStyleGuide">
          <div className="compactStyleHeadline">
            <div className="eyebrow"><span /> ЖУРНАЛ ФАСАДНЫХ РЕШЕНИЙ</div>
            <h2>Найдите стиль,<br />который подойдёт <em>вашему дому</em></h2>
            <p>Не выбирайте фасад по одному красивому кадру. Сравните направления и найдите решение, которое хочется примерить к своему дому.</p>
          </div>
          <div className="compactStyleCopy">
            <div className="stylePreviewJournal">
              <div className="stylePreviewCount"><strong>10</strong><span>стилей<br />в подробных статьях</span></div>
              <p>Для каждого стиля мы собрали три примера разных домов, объяснили характерные детали и показали подходящие материалы и палитры.</p>
              <div className="stylePreviewFacts" aria-label="Что находится в журнале стилей">
                <span><strong>30</strong> примеров домов</span>
                <span><strong>10</strong> разборов стилей</span>
                <span><strong>Материалы</strong> и палитры</span>
              </div>
              <div className="stylePreviewActions"><a className="button primary" href="/styles">Посмотреть 10 стилей и выбрать свой <Arrow /></a><a className="textLink" href="/gallery">Смотреть готовые фасады <Arrow /></a></div>
            </div>
          </div>
        </div>
      </section>

      <LandingPhotoCheck appUrl={APP_URL} />

      <section className="pricing section shell" id="pricing">
        <div className="pricingHead">
          <div><div className="eyebrow"><span /> КАК ПРОДОЛЖИТЬ</div><h2>Первый вариант бесплатно.<br /><em>Дальше — по вашему выбору.</em></h2></div>
          <p>Сначала оцените результат на своём доме. Платить нужно только тогда, когда захотите получить дополнительные варианты.</p>
        </div>
        <div className="pricingPath" aria-label="Путь от бесплатной генерации к продолжению работы">
          <div className="pricingPathIntro"><span>ПРОСТОЙ СТАРТ</span><strong>Сначала попробуйте — потом решайте</strong></div>
          <div className="pricingPathSteps">
            <div><span>01</span><strong>Создайте первый фасад</strong><small>Первая генерация — бесплатно</small></div>
            <div><span>02</span><strong>Оцените результат</strong><small>Вариант сохранится в проекте</small></div>
            <div><span>03</span><strong>Решите, нужны ли ещё</strong><small>Пакет или 1–3 отдельных ВФ-коина</small></div>
          </div>
        </div>
        <div className="priceGrid paidPriceGrid">
          <article className="priceCard freePlanCard">
            <div><span className="planNum">00</span><h3>Бесплатно</h3><p>Посмотрите свой дом с новой отделкой</p></div>
            <div className="price">{rubles(freePlan.priceMinor)}</div>
            <ul><li><Check /> {vfCoinsLabel(freePlan.credits)} на пробную генерацию</li><li><Check /> 4 популярных стиля и автоподбор</li><li><Check /> Автоматическая проверка результата</li><li><Check /> Водяной знак на изображении</li></ul>
            <a className="button ghost" href="#photo-check" data-analytics-event="pricing_cta" data-analytics-plan="FREE">Создать фасад бесплатно <Arrow /></a>
          </article>
          <article className="priceCard featured">
            <div className="popular">ПОПУЛЯРНЫЙ ТАРИФ</div>
            <div><span className="planNum">01</span><h3>Старт</h3><p>Для нескольких вариантов одного дома</p></div>
            <div className="price">{rubles(startPlan.priceMinor)}</div>
            <ul><li><Check /> До {generationLimitLabel(ordinaryGenerations(startPlan))}</li><li><Check /> 4 популярных стиля и подходящие материалы</li><li><Check /> Обычные генерации с автопроверкой</li></ul>
            <button className="button primary" data-analytics-event="pricing_cta" data-analytics-plan="START" onClick={() => startOrder("visual")}>Выбрать пакет <Arrow /></button>
          </article>
          <article className="priceCard">
            <div><span className="planNum">02</span><h3>Оптимум</h3><p>Для исследования нескольких стилей</p></div>
            <div className="price">{rubles(optimumPlan.priceMinor)}</div>
            <ul><li><Check /> До {generationLimitLabel(ordinaryGenerations(optimumPlan))}</li><li><Check /> 7 стилей и расширенный выбор материалов</li><li><Check /> Pro-генерация и сравнение до четырёх решений</li></ul>
            <button className="button ghost" data-analytics-event="pricing_cta" data-analytics-plan="OPTIMUM" onClick={() => startOrder("selection")}>Выбрать пакет <Arrow /></button>
          </article>
          <article className="priceCard premium">
            <div><span className="planNum">03</span><h3>Максимум</h3><p>Для большого числа концепций</p></div>
            <div className="price">{rubles(maximumPlan.priceMinor)}</div>
            <ul><li><Check /> До {generationLimitLabel(ordinaryGenerations(maximumPlan))}</li><li><Check /> Все 10 стилей и все материалы</li><li><Check /> Pro, точечные доработки готового варианта, сравнение и 4K</li></ul>
            <button className="button copper" data-analytics-event="pricing_cta" data-analytics-plan="MAXIMUM" onClick={() => startOrder("realization")}>Выбрать пакет <Arrow /></button>
          </article>
        </div>
        <div className="pricingContinuation">
          <div className="pricingContinuationCopy"><span>ПОСЛЕ БЕСПЛАТНОГО РЕЗУЛЬТАТА</span><strong>Продолжайте в удобном формате</strong></div>
          <div className="pricingContinuationOptions">
            <span><b>Пакет</b> для серии вариантов</span>
            <span><b>1–3 ВФ-коина</b> для точечной задачи</span>
          </div>
          <a href="/app/balance#topups">Добавить ВФ-коины <Arrow /></a>
        </div>
        <p className="pricingNote">{PAYMENTS_ENABLED
          ? "Разовая покупка ВФ-коинов доступна в кабинете. Подписки и автопродление выключены."
          : "Оплата временно выключена и не показывается в кабинете."} Перед запуском сервис показывает точную стоимость действия в ВФ-коинах.</p>
      </section>

      <section className="faq section shell" id="faq">
        <div className="faqTitle"><div className="eyebrow"><span /> ВОПРОСЫ И ОТВЕТЫ</div><h2>Всё важное<br /><em>до загрузки фото</em></h2></div>
        <div className="faqList">
          {faqs.map(([question, answer], index) => (
            <button className={openFaq === index ? "faqItem active" : "faqItem"} key={question} onClick={() => setOpenFaq(openFaq === index ? null : index)}>
              <span><b>{String(index + 1).padStart(2, "0")}</b>{question}</span><i>{openFaq === index ? "−" : "+"}</i>
              <p>{answer}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="finalCta">
        <div className="shell finalInner">
          <div className="eyebrow light"><span /> НАЧНИТЕ С ОДНОЙ ФОТОГРАФИИ</div>
          <h2>Посмотрите, каким может стать<br /><em>ваш дом.</em></h2>
          <a className="button lightButton" href="#photo-check" data-analytics-event="hero_cta" data-analytics-placement="footer"><UploadIcon /> Создать первый фасад бесплатно</a>
          <p>Без привязки карты · первая генерация бесплатно · фото хранится приватно</p>
        </div>
      </section>

      <footer className="footer shell">
        <div className="footerBrand">
          <div className="logo"><span className="logoMark">ВФ</span><span>ВИЖУФАСАД<small>ВИЗУАЛИЗАЦИЯ ФАСАДОВ ПО ФОТО</small></span></div>
          <p>Визуализация отделки домов и строений по всей России.</p>
        </div>
        <nav className="footerGroup" aria-label="Разделы сайта"><strong>Сервис</strong><a href="#pricing">Тарифы</a><a href="#faq">Вопросы</a><a href="/gallery">Примеры</a><a href="/partners">Партнёрам</a></nav>
        <nav className="footerGroup" aria-label="Полезные материалы"><strong>Материалы</strong><a href="/styles">Каталог стилей</a><a href="/visualizaciya-fasada-po-foto">Фасад по фото</a><a href="/stili-i-materialy-fasada">Стили и материалы</a></nav>
        <nav className="footerGroup" aria-label="Правовая информация"><strong>Документы</strong><a href="/legal">Правовая информация</a><a href="/legal/offer">Публичная оферта</a><a href="/legal/refunds">Возвраты</a><a href="/legal/privacy">Конфиденциальность</a><button type="button" className="footerPrivacyButton" data-privacy-settings>Настройки конфиденциальности</button></nav>
        <address className="footerOwner"><strong>Исполнитель</strong><span>Сухов Максим Сергеевич</span><span>Самозанятый, плательщик НПД</span><span>ИНН 583712808341</span><a href="mailto:vizhufasad0058@bk.ru">vizhufasad0058@bk.ru</a></address>
        <div className="footerBottom"><small>© 2026 ВИЖУФАСАД</small><span>Условия цифровой услуги опубликованы в публичной оферте</span></div>
      </footer>

      {videoOpen && (
        <div className="videoBackdrop" role="dialog" aria-modal="true" aria-labelledby="video-title" onMouseDown={(event) => { if (event.currentTarget === event.target) setVideoOpen(false); }}>
          <div className="videoDialog">
            <div className="videoDialogHead">
              <div><span>ВИДЕОИНСТРУКЦИЯ · 3 МИНУТЫ</span><h3 id="video-title">Как создать визуализацию фасада</h3></div>
              <button className="videoClose" type="button" onClick={() => setVideoOpen(false)} aria-label="Закрыть видео">×</button>
            </div>
            <video className="videoFrame" controls autoPlay preload="metadata" playsInline poster="/vizhufasad-video-instruction-with-styles-poster.jpg">
              <source src="/vizhufasad-video-instruction-with-styles-720p.mp4" type="video/mp4" />
              Ваш браузер не поддерживает воспроизведение видео.
            </video>
          </div>
        </div>
      )}

      {LEGACY_LEADS_ENABLED && modal && (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Загрузка фото дома" onMouseDown={(e) => { if (e.currentTarget === e.target) setModal(false); }}>
          <div className="modal">
            <button className="modalClose" onClick={() => setModal(false)} aria-label="Закрыть">×</button>
            {sent ? (
              <div className="success"><div><Check /></div><h3>Заявка принята</h3><p>{photoQuality}. Номер заказа: <strong>{orderId}</strong></p><p>Сохраняйте номер — по нему можно будет отслеживать этапы автоматической обработки.</p></div>
            ) : (
              <>
                <div className="modalEyebrow">ШАГ {step} ИЗ 2 · {packageNames[selectedPackage].toUpperCase()}</div>
                <h3>{step === 1 ? "Покажите ваш дом" : "Куда отправить результат?"}</h3>
                <p>{step === 1 ? "Загрузите одно понятное фото. JPG, PNG или WEBP до 15 МБ." : "Оставьте контакты и коротко опишите, какой фасад вам нравится."}</p>
                {step === 1 ? (
                  <>
                    <label className={preview ? "dropzone hasPreview" : "dropzone"}>
                      {preview ? <img src={preview} alt="Предпросмотр загруженного дома" /> : <><UploadIcon /><strong>Перетащите фото сюда</strong><span>или нажмите, чтобы выбрать</span></>}
                      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} />
                    </label>
                    {fileName && <div className="fileName"><Check /> {fileName}</div>}
                    <button className="button primary modalButton" disabled={!preview} onClick={() => setStep(2)}>Продолжить <Arrow /></button>
                  </>
                ) : (
                  <div className="form">
                    <label>Ваше имя<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Максим" autoComplete="name" /></label>
                    <label>Телефон, почта или MAX<input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="+7 900 000-00-00" autoComplete="tel" /></label>
                    <label>Пожелания<textarea value={wishes} onChange={(e) => setWishes(e.target.value)} placeholder="Светлый фасад, дерево, современный стиль…" /></label>
                    <label className="consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>Даю отдельное <a href="/legal/personal-data-consent" target="_blank" rel="noopener noreferrer">согласие на обработку персональных данных</a></span></label>
                    {submitError && <div className="formError" role="alert">{submitError}</div>}
                    <button className="button primary modalButton" disabled={sending} onClick={submit}>{sending ? "Отправляем…" : "Отправить заявку"} {!sending && <Arrow />}</button>
                    <button className="back" onClick={() => setStep(1)}>← Вернуться к фото</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "@id": `${SITE_ORIGIN}/#webapp`,
        name: "ВИЖУФАСАД",
        url: SITE_ORIGIN,
        applicationCategory: "DesignApplication",
        operatingSystem: "Web",
        description: "Автоматическая визуализация вариантов фасада дома по фотографии с выбором стиля, материалов и цвета.",
        offers: { "@type": "Offer", price: "0", priceCurrency: "RUB", description: "Одна пробная визуализация фасада с водяным знаком" },
        provider: { "@id": `${SITE_ORIGIN}/#organization` },
      }} />
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map(([question, answer]) => ({
          "@type": "Question", name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      }} />
    </main>
  );
}
