import type { Metadata } from "next";
import { JsonLd } from "../JsonLd";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://vizhufasad.ru";
const contactEmail = "vizhufasad0058@bk.ru";

export const metadata: Metadata = {
  title: "Партнёрская программа ВИЖУФАСАД — договор и ВФ-коины",
  description: "Прямое сотрудничество с владельцем ВИЖУФАСАД для продавцов фасадных материалов, производителей и подрядчиков: договор, именной код и согласованный объём ВФ-коинов.",
  alternates: { canonical: "/partners" },
};

const mailto = `mailto:${contactEmail}?subject=${encodeURIComponent("Партнёрство с ВИЖУФАСАД")}&body=${encodeURIComponent("Здравствуйте, Максим! Хотим обсудить партнёрский договор с ВИЖУФАСАД.\n\nКомпания / ФИО:\nИНН:\nКонтактное лицо:\nТелефон:\nПредполагаемый объём ВФ-коинов:\n")}`;

export default function PartnersPage() {
  return <main className="seoPage partnerPage">
    <header className="seoHeader shell">
      <a className="logo" href="/"><span className="logoMark">ВФ</span><span>ВИЖУФАСАД<small>AI-ВИЗУАЛИЗАЦИЯ ФАСАДОВ</small></span></a>
      <nav aria-label="Основная навигация"><a href="/gallery">Примеры</a><a href="/styles">Стили</a><a href="/#pricing">Тарифы</a><a className="seoHeaderCta" href="#partner-contact">Как заключить договор</a></nav>
    </header>

    <section className="seoHero partnerHero">
      <div className="shell partnerHeroGrid">
        <div>
          <nav className="seoBreadcrumb" aria-label="Хлебные крошки"><span><a href="/">Главная</a></span><span><i aria-hidden="true">/</i><span>Партнёрам</span></span></nav>
          <div className="eyebrow light"><span /> ПРЯМОЙ ДОГОВОР С ВЛАДЕЛЬЦЕМ</div>
          <h1>Помогите клиенту увидеть фасад до покупки материалов</h1>
          <p>Партнёрский доступ ВИЖУФАСАД помогает продавцам фасадных материалов, производителям и подрядчикам показывать варианты отделки на фотографии реального дома клиента.</p>
          <div className="partnerHeroActions"><a className="button lightButton" href="#partner-contact">Перейти к оформлению</a><a className="partnerTextLink" href="/documents/vizhufasad-partner-contract-template.pdf" target="_blank" rel="noopener">Посмотреть образец договора →</a></div>
        </div>
        <aside className="partnerTrustCard"><span>Договорная схема</span><strong>Сумма и объём фиксируются заранее</strong><ul><li>Именной код для согласованного email</li><li>ВФ-коины начисляются целиком и один раз</li><li>Без подписки и автоматического списания</li><li>Расчёт напрямую с владельцем сервиса</li></ul></aside>
      </div>
    </section>

    <section className="partnerIntro shell">
      <div><p className="eyebrow"><span /> КОМУ ПОДХОДИТ</p><h2>Инструмент для предметного разговора с заказчиком</h2></div>
      <div className="partnerAudienceGrid">
        <article><strong>Магазинам и салонам</strong><p>Показать сочетание штукатурки, клинкера, панелей, дерева и других материалов до оформления заказа.</p></article>
        <article><strong>Производителям</strong><p>Дополнить консультацию наглядным вариантом фасада в выбранной палитре и материале.</p></article>
        <article><strong>Подрядчикам</strong><p>Быстрее согласовать направление отделки и перейти к технической оценке уже выбранной идеи.</p></article>
      </div>
    </section>

    <section className="partnerHow">
      <div className="shell"><p className="eyebrow light"><span /> КАК НАЧАТЬ</p><h2>От договора до рабочего кабинета</h2>
        <ol className="partnerSteps">
          <li><span>01</span><div><strong>Согласовываем условия</strong><p>Вы связываетесь с владельцем. В договоре фиксируются стороны, email аккаунта, количество ВФ-коинов, стоимость, срок и порядок расчётов.</p></div></li>
          <li><span>02</span><div><strong>Оплачиваете по договору</strong><p>После поступления оплаты Исполнитель формирует чек плательщика НПД и выпускает именной одноразовый код на согласованный номинал.</p></div></li>
          <li><span>03</span><div><strong>Активируете код</strong><p>Партнёр входит в кабинет с указанным в договоре email и вводит код в разделе баланса. Начисляется договорный номинал и открываются все возможности тарифа «Максимум».</p></div></li>
          <li><span>04</span><div><strong>Создаёте проекты</strong><p>ВФ-коины расходуются на доступные действия сервиса. История проектов и результаты сохраняются в кабинете по общим правилам ВИЖУФАСАД.</p></div></li>
        </ol>
      </div>
    </section>

    <section className="partnerTerms shell">
      <div><p className="eyebrow"><span /> ПРОЗРАЧНЫЕ УСЛОВИЯ</p><h2>Что фиксируется в договоре</h2><p>Партнёр заранее знает объём и стоимость. ВФ-коин — внутренняя учётная единица сервиса, а не валюта или средство платежа.</p></div>
      <dl>
        <div><dt>Получатель</dt><dd>Организация или ИП и email назначенного пользователя аккаунта, которому предназначен код.</dd></div>
        <div><dt>Объём и доступ</dt><dd>Точное количество ВФ-коинов, все возможности тарифа «Максимум» и срок, в течение которого можно активировать код и использовать услуги.</dd></div>
        <div><dt>Стоимость</dt><dd>Сумма в рублях, порядок оплаты и порядок выдачи чека плательщика НПД.</dd></div>
        <div><dt>Результат</dt><dd>Автоматические концепции внешнего вида. Сервис не заменяет проект, смету, обследование и расчёт материалов.</dd></div>
        <div><dt>Данные</dt><dd>Email применяется для именной привязки. В реестре кодов сохраняются HMAC адреса и его маска, а не дополнительная открытая копия.</dd></div>
        <div><dt>Поддержка</dt><dd>Договор и рабочие вопросы обсуждаются напрямую с владельцем ВИЖУФАСАД по указанным контактам.</dd></div>
      </dl>
    </section>

    <section className="partnerContract">
      <div className="shell partnerContractGrid"><div><p className="eyebrow light"><span /> ДОКУМЕНТЫ</p><h2>Образец партнёрского договора</h2><p>В шаблоне уже указаны реквизиты Исполнителя и условия цифровой услуги. Перед подписанием стороны заполняют сведения о Заказчике, email кабинета, объём ВФ-коинов, стоимость и сроки. Финальная редакция согласуется напрямую с владельцем сервиса.</p></div>
        <div className="partnerContractActions"><a className="button lightButton" href="/documents/vizhufasad-partner-contract-template.pdf" target="_blank" rel="noopener">Открыть PDF</a><a className="button partnerOutlineButton" href="/documents/vizhufasad-partner-contract-template.docx" download>Скачать DOCX для заполнения</a><small>Образец не является публичной офертой и сам по себе не создаёт обязательств до согласования и подписания сторонами.</small></div>
      </div>
    </section>

    <section className="partnerFaq shell"><p className="eyebrow"><span /> ВОПРОСЫ</p><h2>Перед заключением договора</h2><div>
      <details><summary>Можно ли указать любое количество ВФ-коинов?</summary><p>Да. Номинал определяется условиями конкретного договора. После выпуска кода изменить его нельзя: при изменении условий выпускается новый код, а прежний отключается.</p></details>
      <details><summary>Можно ли передать код сотруднику?</summary><p>Код действует только для email, указанного в договоре. Для нескольких кабинетов выпускаются отдельные коды с согласованным распределением ВФ-коинов.</p></details>
      <details><summary>Какие возможности получает партнёр?</summary><p>После активации кода аккаунту доступны все 10 стилей и материалы, Pro, сравнение вариантов, точечные доработки и подготовка 4K — полный набор тарифа «Максимум». ВФ-коины расходуются по стоимости выбранных действий.</p></details>
      <details><summary>Можно ли публиковать результаты?</summary><p>Права на исходные фотографии должны быть у загружающей стороны. Публикация пользовательских материалов в рекламе или портфолио требует отдельного согласия правообладателя.</p></details>
    </div></section>

    <section className="partnerFinal" id="partner-contact"><div className="shell"><p className="eyebrow light"><span /> ПРЯМОЙ КОНТАКТ С ВЛАДЕЛЬЦЕМ</p><h2>Заключить партнёрский договор</h2><p>Отправьте письмо Максиму Сухову. Укажите компанию или ФИО, ИНН, контактное лицо, телефон и предполагаемое количество ВФ-коинов. В ответ вы получите согласованные условия и договор для подписания.</p><div className="partnerContactPanel"><span>Почта для партнёрских обращений</span><a className="partnerEmail" href={`mailto:${contactEmail}`}>{contactEmail}</a><small>Если почтовая программа не открылась, скопируйте адрес и напишите с корпоративной или личной почты.</small></div><div className="partnerContactActions"><a className="button lightButton" href={mailto}>Открыть готовое письмо</a><a className="button partnerOutlineButton" href="/documents/vizhufasad-partner-contract-template.pdf" target="_blank" rel="noopener">Посмотреть договор</a></div></div></section>

    <footer className="seoFooter shell"><a href="/">Главная</a><a href="/gallery">Примеры</a><a href="/styles">Каталог стилей</a><a href="/#pricing">Тарифы</a><a href="/legal">Правовая информация</a><a href="/legal/privacy">Конфиденциальность</a></footer>
    <JsonLd data={{ "@context": "https://schema.org", "@type": "WebPage", name: "Партнёрская программа ВИЖУФАСАД", url: `${siteOrigin}/partners`, description: "Прямое договорное сотрудничество с ВИЖУФАСАД для компаний фасадной отрасли." }} />
  </main>;
}
