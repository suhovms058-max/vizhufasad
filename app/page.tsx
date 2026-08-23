"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { HeroFacadeCarousel } from "./HeroFacadeCarousel";
import { LandingPhotoCheck } from "./LandingPhotoCheck";
import { JsonLd } from "./JsonLd";
import { facadeStyles } from "./facadeStyleCatalog";

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

const faqs = [
  ["Нужно ли знать названия материалов?", "Нет. Можно выбрать автоподбор или отметить желаемые материалы и цвета самостоятельно."],
  ["Изменится ли форма дома?", "Наша задача — сохранить геометрию, окна, двери и кровлю. Визуализация показывает отделку, а не придумывает другое здание."],
  ["Какое фото подойдёт?", "Снимите дом днём, целиком, без деревьев и машин перед фасадом. Лучше всего — прямо или под небольшим углом."],
  ["Где хранится загруженная фотография?", "После отдельного согласия исходник передаётся в приватное объектное хранилище. Файлы доступны владельцу проекта только по временным ссылкам и удаляются вместе с проектом или аккаунтом."],
  ["Что произойдёт, если генерация исказит дом?", "Результат проходит автоматическую проверку. При грубом изменении выполняется одна бесплатная повторная попытка, а после второй неудачи кредит возвращается и брак не показывается."],
  ["Что может отличаться от будущей отделки?", "Оттенок и фактура реального материала зависят от производителя, освещения и экрана. Мелкий декор и детали участка тоже могут отличаться: сервис помогает выбрать визуальное направление, а не фиксирует строительную спецификацию."],
  ["Когда списывается кредит и что будет при технической ошибке?", "Перед запуском действия кредит резервируется один раз. После успешного результата списание подтверждается, а при технической неудаче или окончательном отклонении автоматической проверкой кредит возвращается автоматически. Повторный запрос не создаёт двойного списания или возврата."],
  ["Можно ли описать свои пожелания?", "Да. В мастере проекта можно указать материалы, цвета, отделку карниза, цоколя и существующих опор. Пожелания автоматически входят в задание генератору."],
  ["Это строительный проект?", "Нет. Результат — концепция внешнего вида фасада, а не чертёж, смета или инструкция для строителей."],
];

export default function App() {
  const [modal, setModal] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<PackageId>("trial");
  const [preview, setPreview] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [sent, setSent] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [wishes, setWishes] = useState("");
  const [consent, setConsent] = useState(true);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [orderId, setOrderId] = useState("");
  const [photoQuality, setPhotoQuality] = useState("");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [publicCatalog, setPublicCatalog] = useState<{ tariffs: PublicTariff[]; actions: PublicAction[] } | null>(null);

  useEffect(() => {
    document.body.style.overflow = modal ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [modal]);

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
      window.location.assign(APP_URL);
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
  const standardVariants = (plan: PublicTariff) => Math.floor(plan.credits / standardCost);

  return (
    <main>
      <header className="header shell">
        <a className="logo" href="#top" aria-label="ВИЖУФАСАД — главная">
          <span className="logoMark">ВФ</span>
          <span>ВИЖУФАСАД<small>AI-ВИЗУАЛИЗАЦИЯ ФАСАДОВ</small></span>
        </a>
        <nav aria-label="Главное меню">
          <a href="#how">Как это работает</a>
          <a href="#pricing">Тарифы</a>
          <a href="#examples">Примеры</a>
          <a href="#faq">Вопросы</a>
        </nav>
        <a className="headerCta" href="#photo-check" data-analytics-event="hero_cta" data-analytics-placement="header">Попробовать бесплатно <Arrow /></a>
      </header>

      <section className="hero shell" id="top">
        <div className="heroCopy">
          <div className="eyebrow"><span /> ДИЗАЙН ФАСАДА ПО ФОТОГРАФИИ</div>
          <h1>Создайте дизайн фасада своего дома <em>с помощью ИИ</em> по фотографии</h1>
          <p>Выберите стиль, материалы и цвета — сервис покажет, как будет выглядеть ваш дом с новой отделкой.</p>
          <div className="heroActions">
            <a className="button primary" href="#photo-check" data-analytics-event="hero_cta" data-analytics-placement="hero"><UploadIcon /> Попробовать бесплатно</a>
            <a className="textLink" href="#examples">Посмотреть примеры <Arrow /></a>
          </div>
          <div className="microTrust">
            <span><Check /> 1 пробная визуализация</span>
            <span><Check /> Геометрия дома под защитой</span>
            <span><Check /> Полностью автоматически</span>
          </div>
          <p className="conceptNote">Визуальная концепция, а не строительный проект или расчёт материалов.</p>
        </div>

        <HeroFacadeCarousel />
      </section>

      <section className="signal">
        <div className="shell signalGrid">
          <p>Не выбирайте отделку<br /><i>вслепую.</i></p>
          <div><strong>1 фото</strong><span>достаточно для старта</span></div>
          <div><strong>1 кредит</strong><span>за Standard-вариант</span></div>
          <div><strong>3 шага</strong><span>от фото до результата</span></div>
        </div>
      </section>

      <LandingPhotoCheck appUrl={APP_URL} />

      <section className="processShowcase section" id="how" aria-labelledby="process-title">
        <div className="processGlow" aria-hidden="true" />
        <div className="shell processLayout">
          <div className="processIntro">
            <div>
              <div className="eyebrow light"><span /> ПРОСТОЙ ПУТЬ К РЕЗУЛЬТАТУ</div>
              <h2 id="process-title">От фотографии<br />до решения<br /><em>за 3 шага</em></h2>
            </div>
            <p>Мы убрали из процесса всё сложное. Вы показываете дом и выбираете направление отделки. Остальное делает сервис.</p>
          </div>
          <div className="processSteps" aria-label="Три шага визуализации фасада дома по фотографии">
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
                <p>Снимок дома с телефона — целиком, при дневном свете и без крупных препятствий перед фасадом.</p>
              </div>
            </article>
            <article className="processStep processChoice">
              <div className="processMedia processReferenceMedia">
                <img src="/process-step-materials.webp" alt="Коллаж выбора отделки фасада: дерево, штукатурка, камень, палитра цветов и архитектурный эскиз" width="366" height="620" loading="lazy" decoding="async" />
              </div>
              <div className="processBody">
                <h3>Выберите направление</h3>
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
                <h3>Получите варианты</h3>
                <p>Сравните решения с исходной фотографией и выберите фасад, который хочется реализовать.</p>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="deliver section">
        <div className="shell deliverGrid">
          <div className="deliverVisual">
            <img src="./facade-after-bright.webp" alt="Готовая визуализация современного фасада" />
            <div className="materialCard"><span>МАТЕРИАЛ 02</span><strong>Планкен<br />натуральный</strong><small>Фрагмент визуализации</small></div>
          </div>
          <div className="deliverCopy">
            <div className="eyebrow"><span /> НЕ ТОЛЬКО КРАСИВАЯ КАРТИНКА</div>
            <h2>Фасад, который<br />можно <em>реализовать</em></h2>
            <p className="lead">ИИ учитывает выбранный стиль, материалы и цвета, сохраняет защищённую геометрию дома и автоматически проверяет результат.</p>
            <ul>
              <li><Check /><span><strong>Автоматическая проверка</strong>ИИ сверяет окна, двери, кровлю и пропорции с исходной фотографией.</span></li>
              <li><Check /><span><strong>Настройки пользователя</strong>Стиль, отделка, палитра и ограничения входят в задание генератору.</span></li>
              <li><Check /><span><strong>Только проверенный результат</strong>При грубом изменении дома выполняется автоматический повтор или возврат кредита.</span></li>
            </ul>
            <a className="textLink" href="#photo-check">Создать свой проект <Arrow /></a>
          </div>
        </div>
      </section>

      <section className="stylePreview section" id="examples">
        <div className="shell">
          <div className="stylePreviewHead">
            <div><div className="eyebrow"><span /> ОДИН ДОМ — РАЗНЫЕ РЕШЕНИЯ</div><h2>Сравните <em>характер фасада</em>,<br />не меняя сам дом</h2></div>
            <p>Три подтверждённых демонстрационных варианта помогают увидеть разницу в материалах, палитре и деталях. Без случайных домов и вымышленных примеров.</p>
          </div>
          <div className="homeStyleGrid">
            {facadeStyles.map((style) => <article key={style.slug}>
              <a href={`/styles/${style.slug}`} aria-label={`Подробнее о стиле «${style.title}»`}><img src={style.image} alt={style.imageAlt} width="1200" height="900" loading="lazy" /></a>
              <div><p className="eyebrow">ДЕМОНСТРАЦИОННЫЙ ПРИМЕР</p><h3>{style.title}</h3><p>{style.summary}</p><small>{style.materials.join(" · ")}</small></div>
            </article>)}
          </div>
          <div className="stylePreviewActions"><a className="button primary" href="/gallery">Посмотреть все примеры <Arrow /></a><a className="textLink" href="/styles">Разобраться в стилях и материалах <Arrow /></a></div>
        </div>
      </section>

      <section className="pricing section shell" id="pricing">
        <div className="pricingHead">
          <div><div className="eyebrow"><span /> ЕДИНЫЕ КРЕДИТЫ</div><h2>Начните бесплатно.<br /><em>Выбирайте пакет</em>, когда нужно.</h2></div>
          <p>Standard стоит 1 кредит. Assessment и скачивание результата бесплатны.</p>
        </div>
        <div className="freeStart">
          <div><div className="eyebrow"><span /> БЕСПЛАТНЫЙ СТАРТ</div><h3>Standard-варианты после первого входа: {standardVariants(freePlan)}</h3><p>Проверьте свой дом и механику сервиса до покупки пакета. На бесплатном результате остаётся водяной знак.</p></div>
          <div className="freeStartPrice"><strong>{rubles(freePlan.priceMinor)}</strong><span>автопроверка и скачивание включены</span></div>
          <a className="button primary" href="#photo-check" data-analytics-event="pricing_cta" data-analytics-plan="FREE">Попробовать бесплатно <Arrow /></a>
        </div>
        <div className="priceGrid paidPriceGrid">
          <article className="priceCard featured">
            <div className="popular">ПОПУЛЯРНЫЙ СТАРТ</div>
            <div><span className="planNum">01</span><h3>Старт</h3><p>Для нескольких вариантов одного дома</p></div>
            <div className="price">{rubles(startPlan.priceMinor)}</div>
            <ul><li><Check /> До {standardVariants(startPlan)} Standard-вариантов</li><li><Check /> Кредиты для Pro и доработок</li><li><Check /> История результатов</li></ul>
            <button className="button primary" data-analytics-event="pricing_cta" data-analytics-plan="START" onClick={() => startOrder("visual")}>Открыть кабинет <Arrow /></button>
          </article>
          <article className="priceCard">
            <div><span className="planNum">02</span><h3>Оптимум</h3><p>Для исследования нескольких стилей</p></div>
            <div className="price">{rubles(optimumPlan.priceMinor)}</div>
            <ul><li><Check /> До {standardVariants(optimumPlan)} Standard-вариантов</li><li><Check /> Сравнение до четырёх решений</li><li><Check /> Кредиты для Pro и доработок</li></ul>
            <button className="button ghost" data-analytics-event="pricing_cta" data-analytics-plan="OPTIMUM" onClick={() => startOrder("selection")}>Открыть кабинет <Arrow /></button>
          </article>
          <article className="priceCard premium">
            <div><span className="planNum">03</span><h3>Максимум</h3><p>Для большого числа концепций</p></div>
            <div className="price">{rubles(maximumPlan.priceMinor)}</div>
            <ul><li><Check /> До {standardVariants(maximumPlan)} Standard-вариантов</li><li><Check /> Сравнение до четырёх решений</li><li><Check /> Для нескольких домов и серий вариантов</li></ul>
            <button className="button copper" data-analytics-event="pricing_cta" data-analytics-plan="MAXIMUM" onClick={() => startOrder("realization")}>Открыть кабинет <Arrow /></button>
          </article>
        </div>
        <p className="pricingNote">{PAYMENTS_ENABLED
          ? "Разовая покупка кредитов доступна в кабинете. Подписки и автопродление выключены."
          : "Оплата временно выключена и не показывается в кабинете."} Актуальные цены и количество кредитов загружаются из единого серверного справочника.</p>
      </section>

      <section className="audience section">
        <div className="shell audienceGrid">
          <div><div className="eyebrow"><span /> СДЕЛАНО ДЛЯ ВЛАДЕЛЬЦА ДОМА</div><h2>Все настройки<br /><em>в ваших руках</em></h2></div>
          <div className="quote"><span>“</span><p>Я хочу просто увидеть, как будет выглядеть мой дом, до того как потрачу деньги на материалы.</p><small>ГЛАВНАЯ ЗАДАЧА, КОТОРУЮ МЫ РЕШАЕМ</small></div>
        </div>
      </section>

      <section className="faq section shell" id="faq">
        <div className="faqTitle"><div className="eyebrow"><span /> ВОПРОСЫ И ОТВЕТЫ</div><h2>Всё важное<br /><em>до загрузки фото</em></h2></div>
        <div className="faqList">
          {faqs.map(([question, answer], index) => (
            <button className={openFaq === index ? "faqItem active" : "faqItem"} key={question} onClick={() => setOpenFaq(openFaq === index ? null : index)}>
              <span><b>0{index + 1}</b>{question}</span><i>{openFaq === index ? "−" : "+"}</i>
              <p>{answer}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="finalCta">
        <div className="shell finalInner">
          <div className="eyebrow light"><span /> НАЧНИТЕ С ОДНОЙ ФОТОГРАФИИ</div>
          <h2>Посмотрите варианты отделки<br /><em>для своего дома.</em></h2>
          <a className="button lightButton" href="#photo-check" data-analytics-event="hero_cta" data-analytics-placement="footer"><UploadIcon /> Загрузить фото бесплатно</a>
          <p>Без оплаты · Первый пример с водяным знаком</p>
        </div>
      </section>

      <footer className="footer shell">
        <div className="logo"><span className="logoMark">ВФ</span><span>ВИЖУФАСАД<small>AI-ВИЗУАЛИЗАЦИЯ ФАСАДОВ</small></span></div>
        <p>Визуализация отделки домов и строений по всей России.</p>
        <div><a href="#pricing">Тарифы</a><a href="#faq">Вопросы</a><a href="/gallery">Примеры</a><a href="/styles">Каталог стилей</a><a href="/visualizaciya-fasada-po-foto">Фасад по фото</a><a href="/stili-i-materialy-fasada">Стили и материалы</a><a href="/partners">Партнёрам</a><a href="/legal/offer">Условия оплаты</a><a href="/legal/privacy">Конфиденциальность</a><a href="/legal/refunds">Возвраты</a><a href="mailto:vizhufasad0058@bk.ru">vizhufasad0058@bk.ru</a></div>
        <small>© 2026 ВИЖУФАСАД · Условия цифровой услуги опубликованы в публичной оферте</small>
      </footer>

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
                    <label className="consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>Согласен на обработку данных и получение ответа по заявке</span></label>
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
