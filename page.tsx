"use client";

import { ChangeEvent, useEffect, useState } from "react";

const LEADS_API = "https://89-23-97-248.sslip.io/api/leads";

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
  trial: "Бесплатный пример",
  visual: "Визуал",
  selection: "Подбор фасада",
  realization: "Фасад под реализацию",
};

const faqs = [
  ["Нужно ли знать названия материалов?", "Нет. Достаточно загрузить фото и выбрать понравившееся направление. Для тарифа «Подбор фасада» мы предложим реальные материалы, доступные в России."],
  ["Изменится ли форма дома?", "Наша задача — сохранить геометрию, окна, двери и кровлю. Визуализация показывает отделку, а не придумывает другое здание."],
  ["Какое фото подойдёт?", "Снимите дом днём, целиком, без деревьев и машин перед фасадом. Лучше всего — прямо или под небольшим углом."],
  ["Что нужно для расчёта материалов?", "Размеры стен, проёмов и цоколя или готовый чертёж. Если чего-то не хватает, специалист подскажет, как измерить."],
];

export default function App() {
  const [compare, setCompare] = useState(54);
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

  useEffect(() => {
    document.body.style.overflow = modal ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [modal]);

  const startOrder = (id: PackageId) => {
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
        <button className="headerCta" onClick={() => startOrder("trial")}>Попробовать бесплатно <Arrow /></button>
      </header>

      <section className="hero shell" id="top">
        <div className="heroCopy">
          <div className="eyebrow"><span /> ВИЗУАЛИЗАЦИЯ ПО ВАШЕМУ ФОТО</div>
          <h1>Посмотрите новый<br />фасад <em>до</em><br />начала работ</h1>
          <p>Загрузите фото дома — получите реалистичный вариант отделки с сохранением его геометрии. Без сложных программ и долгих объяснений.</p>
          <div className="heroActions">
            <button className="button primary" onClick={() => startOrder("trial")}><UploadIcon /> Загрузить фото дома</button>
            <a className="textLink" href="#examples">Посмотреть примеры <Arrow /></a>
          </div>
          <div className="microTrust">
            <span><Check /> Первый пример бесплатно</span>
            <span><Check /> Автоматическая проверка фото</span>
            <span><Check /> Работаем по всей России</span>
          </div>
        </div>

        <div className="heroVisual" id="examples">
          <div className="visualTop">
            <span>ПРОЕКТ 01 / ЧАСТНЫЙ ДОМ</span>
            <span className="status"><i /> ВИЗУАЛ ГОТОВ</span>
          </div>
          <div className="comparison">
            <img src="./facade-after-bright.webp" alt="Дом после визуализации отделки фасада" />
            <div className="beforeLayer" style={{ clipPath: `inset(0 ${100 - compare}% 0 0)` }}>
              <img src="./facade-before-bright.webp" alt="Дом до отделки фасада" />
            </div>
            <div className="compareLine" style={{ left: `${compare}%` }}><span>↔</span></div>
            <span className="tag beforeTag">ДО</span>
            <span className="tag afterTag">ПОСЛЕ</span>
            <input aria-label="Сравнить фасад до и после" type="range" min="8" max="92" value={compare} onChange={(e) => setCompare(Number(e.target.value))} />
          </div>
          <div className="visualBottom">
            <span><b>3</b> решения на выбор</span>
            <span>Геометрия по фотографии дома сохранена</span>
            <span>Готово от 24 часов*</span>
          </div>
          <p className="visualFootnote">* Зависит от тарифа</p>
        </div>
      </section>

      <section className="signal">
        <div className="shell signalGrid">
          <p>Не выбирайте отделку<br /><i>вслепую.</i></p>
          <div><strong>1 фото</strong><span>достаточно для старта</span></div>
          <div><strong>3 варианта</strong><span>в тарифе «Визуал»</span></div>
          <div><strong>0 программ</strong><span>вам не нужно осваивать</span></div>
        </div>
      </section>

      <section className="processShowcase section" id="how">
        <div className="shell processFrame">
          <img src="./concepts/approved-process-section.webp" alt="Три шага: загрузите фото, выберите направление и получите варианты фасада" />
          <div className="srOnly">
            <h2>От фотографии до решения за 3 шага</h2>
            <p>Загрузите фотографию дома, выберите направление отделки и получите варианты с пояснениями.</p>
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
            <p className="lead">ИИ сохраняет геометрию дома, проверяет результат и подбирает варианты отделки. В тарифе с расчётом специалист дополнительно сверяет размеры и объёмы материалов.</p>
            <ul>
              <li><Check /><span><strong>Автоматическая проверка</strong>ИИ сверяет окна, двери, кровлю и пропорции с исходной фотографией.</span></li>
              <li><Check /><span><strong>Реальные материалы</strong>Сервис предлагает варианты, которые можно купить в России.</span></li>
              <li><Check /><span><strong>Расчёт в старшем тарифе</strong>PDF с решениями и объёмами формируется по точным размерам фасада и проёмов.</span></li>
            </ul>
            <button className="textLink" onClick={() => startOrder("realization")}>Узнать о расчёте материалов <Arrow /></button>
          </div>
        </div>
      </section>

      <section className="pricing section shell" id="pricing">
        <div className="pricingHead">
          <div><div className="eyebrow"><span /> ПОНЯТНЫЕ ТАРИФЫ</div><h2>Начните с малого.<br /><em>Добавьте точность</em>, когда нужно.</h2></div>
          <p>Для первой идеи достаточно фото. Для точного расчёта в тарифе «Под реализацию» понадобятся размеры или чертёж.</p>
        </div>
        <div className="priceGrid">
          <article className="priceCard free">
            <div><span className="planNum">01</span><h3>Пример</h3><p>Проверить, подходит ли вам формат</p></div>
            <div className="price">0 ₽</div>
            <ul><li><Check /> 1 вариант фасада</li><li><Check /> 1 ракурс</li><li><Check /> Водяной знак</li></ul>
            <button className="button ghost" onClick={() => startOrder("trial")}>Попробовать бесплатно <Arrow /></button>
          </article>
          <article className="priceCard featured">
            <div className="popular">ПОПУЛЯРНЫЙ СТАРТ</div>
            <div><span className="planNum">02</span><h3>Визуал</h3><p>Выбрать образ будущего фасада</p></div>
            <div className="price">2 990 ₽</div>
            <ul><li><Check /> 3 варианта отделки</li><li><Check /> 1 ракурс</li><li><Check /> Без водяного знака</li><li><Check /> 1 пакет правок</li></ul>
            <button className="button primary" onClick={() => startOrder("visual")}>Выбрать тариф <Arrow /></button>
          </article>
          <article className="priceCard">
            <div><span className="planNum">03</span><h3>Подбор фасада</h3><p>Визуал + проверка специалистом</p></div>
            <div className="price">6 990 ₽</div>
            <ul><li><Check /> 3 варианта отделки</li><li><Check /> Проверка специалистом</li><li><Check /> Подбор реальных материалов</li><li><Check /> 2 пакета правок</li></ul>
            <button className="button ghost" onClick={() => startOrder("selection")}>Выбрать тариф <Arrow /></button>
          </article>
          <article className="priceCard premium">
            <div><span className="planNum">04 / PREMIUM</span><h3>Под реализацию</h3><p>Для закупки и передачи строителям</p></div>
            <div className="price">19 900 ₽</div>
            <ul><li><Check /> Всё из «Подбора фасада»</li><li><Check /> Расчёт объёмов материалов</li><li><Check /> PDF для строителей</li><li><Check /> Персональное сопровождение</li></ul>
            <button className="button copper" onClick={() => startOrder("realization")}>Обсудить проект <Arrow /></button>
          </article>
        </div>
        <p className="pricingNote">* Расчёт носит ориентировочный характер и уточняется после контрольных замеров на объекте.</p>
      </section>

      <section className="audience section">
        <div className="shell audienceGrid">
          <div><div className="eyebrow"><span /> СДЕЛАНО ДЛЯ ВЛАДЕЛЬЦА ДОМА</div><h2>Не нужно быть<br /><em>дизайнером</em></h2></div>
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
          <h2>Ваш дом уже построен.<br /><em>Пора увидеть его завершённым.</em></h2>
          <button className="button lightButton" onClick={() => startOrder("trial")}><UploadIcon /> Загрузить фото бесплатно</button>
          <p>Без оплаты · Первый пример с водяным знаком</p>
        </div>
      </section>

      <footer className="footer shell">
        <div className="logo"><span className="logoMark">ВФ</span><span>ВИЖУФАСАД<small>AI-ВИЗУАЛИЗАЦИЯ ФАСАДОВ</small></span></div>
        <p>Визуализация отделки домов и строений по всей России.</p>
        <div><a href="#pricing">Тарифы</a><a href="#faq">Вопросы</a><a href="mailto:vizhufasad0058@bk.ru">vizhufasad0058@bk.ru</a></div>
        <small>© 2026 ВИЖУФАСАД · Информация на сайте не является публичной офертой</small>
      </footer>

      {modal && (
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
    </main>
  );
}
