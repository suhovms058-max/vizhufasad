import type { ReactNode } from "react";
import { JsonLd } from "./JsonLd";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://vizhufasad.ru";

type Section = { title: string; body: ReactNode };
type Visual = { src: string; alt: string; caption: string };
type RelatedLink = { href: string; label: string; description: string };
type Faq = { question: string; answer: string };

export function SeoLanding({
  eyebrow, title, lead, sections, path, breadcrumb, parentBreadcrumb, cta = "Загрузить фото дома бесплатно", className, visual, related = [], faq = [], journal = false, journalTitle, journalIntro, readTime = "7 минут чтения",
}: {
  eyebrow: string;
  title: string;
  lead: string;
  sections: Section[];
  path: string;
  breadcrumb: string;
  parentBreadcrumb?: { name: string; path: string };
  cta?: string;
  className?: string;
  visual?: Visual;
  related?: RelatedLink[];
  faq?: Faq[];
  journal?: boolean;
  journalTitle?: string;
  journalIntro?: ReactNode;
  readTime?: string;
}) {
  const breadcrumbItems = [
    { name: "Главная", path: "/" },
    ...(parentBreadcrumb ? [parentBreadcrumb] : []),
    { name: breadcrumb, path },
  ];
  if (journal) {
    return <main className="seoPage seoJournal">
      <header className="seoJournalHeader">
        <div className="shell">
          <a className="logo" href="/"><span className="logoMark">ВФ</span><span>ВИЖУФАСАД<small>ЖУРНАЛ О ФАСАДАХ</small></span></a>
          <nav aria-label="Основная навигация"><a href="/styles">Стили</a><a href="/gallery">Реальные примеры</a><a href="/">О сервисе</a></nav>
        </div>
      </header>
      <section className="seoJournalCover">
        {visual && <figure><img src={visual.src} alt={visual.alt} width="1600" height="1067" /><figcaption>{visual.caption}</figcaption></figure>}
        <div className="seoJournalCoverShade" aria-hidden="true" />
        <div className="shell seoJournalCoverCopy">
          <nav className="seoBreadcrumb" aria-label="Хлебные крошки">{breadcrumbItems.map((item, index) => <span key={item.path}>{index > 0 && <i aria-hidden="true">/</i>}{index < breadcrumbItems.length - 1 ? <a href={item.path}>{item.name}</a> : <span>{item.name}</span>}</span>)}</nav>
          <div className="seoJournalIssue"><span>{eyebrow}</span><i /> <span>{readTime}</span></div>
          <h1>{journalTitle ?? title}</h1>
          <p>{lead}</p>
        </div>
      </section>
      <article className="shell seoJournalArticle">
        <section className="seoJournalOpening"><p>{journalIntro ?? "Красивый фасад редко начинается с необычного материала. Сначала нужно понять, какие цвета и фактуры подходят архитектуре именно вашего дома."}</p></section>
        <aside className="seoJournalNote"><span>Редакционная мысль</span><p>Не выбирайте фасад по одному образцу. Сначала определите общий образ дома, затем проверьте материалы и цвета на его фотографии.</p></aside>
        {sections.map((section, index) => <section className={`seoJournalSection seoJournalSection${index + 1}`} key={section.title}><div className="seoJournalSectionNo">0{index + 1}</div><div><h2>{section.title}</h2><div className="seoJournalSectionBody">{section.body}</div></div></section>)}
        <section className="seoJournalInvitation">
          <div><span className="eyebrow"><i /> Когда направление уже выбрано</span><h2>Перенесите выбранную идею на фотографию своего дома</h2></div>
          <div><p>ВИЖУФАСАД не заменяет проект и подрядчика. Он помогает до покупки материалов увидеть направление отделки на фотографии дома, сравнить варианты и прийти к разговору с более ясной задачей.</p><a className="button" href="/app/new" data-analytics-event="seo_article_cta" data-analytics-placement="article_end">Примерить идею к своему дому <span>→</span></a></div>
        </section>
        {faq.length > 0 && <section className="seoFaq seoJournalFaq"><span className="eyebrow"><i /> Без недоговорённостей</span><h2>Вопросы, которые задают до старта</h2>{faq.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</section>}
        {related.length > 0 && <section className="seoRelated seoJournalRelated"><div><span className="eyebrow"><i /> Следующая страница журнала</span><h2>Продолжите исследование</h2></div><div className="seoRelatedGrid">{related.map((item) => <a key={item.href} href={item.href}><strong>{item.label}</strong><span>{item.description}</span><b>Читать материал <em>→</em></b></a>)}</div></section>}
        <aside className="seoConcept"><strong>Важно</strong><p>ВИЖУФАСАД создаёт концепцию внешнего вида. Это не рабочий строительный проект, не смета и не расчёт материалов.</p></aside>
      </article>
      <footer className="seoFooter shell"><a href="/gallery">Примеры</a><a href="/styles">Каталог стилей</a><a href="/visualizaciya-fasada-po-foto">Фасад по фото</a><a href="/stili-i-materialy-fasada">Стили и материалы</a><a href="/partners">Партнёрам</a><a href="/legal/privacy">Конфиденциальность</a></footer>
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbItems.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: item.path === "/" ? siteOrigin : `${siteOrigin}${item.path}` })),
      }} />
      {faq.length > 0 && <JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })) }} />}
    </main>;
  }

  return <main className={["seoPage", className].filter(Boolean).join(" ")}>
    <header className="seoHeader shell">
      <a className="logo" href="/"><span className="logoMark">ВФ</span><span>ВИЖУФАСАД<small>AI-ВИЗУАЛИЗАЦИЯ ФАСАДОВ</small></span></a>
      <nav aria-label="Основная навигация"><a href="/gallery">Примеры</a><a href="/styles">Стили</a><a href="/#pricing">Тарифы</a><a className="seoHeaderCta" href="/app/new">Создать проект</a></nav>
    </header>
    <section className="seoHero">
      <div className={`shell seoHeroGrid${visual ? " hasVisual" : ""}`}><div><nav className="seoBreadcrumb" aria-label="Хлебные крошки">{breadcrumbItems.map((item, index) => <span key={item.path}>{index > 0 && <i aria-hidden="true">/</i>}{index < breadcrumbItems.length - 1 ? <a href={item.path}>{item.name}</a> : <span>{item.name}</span>}</span>)}</nav><div className="eyebrow light"><span /> {eyebrow}</div><h1>{title}</h1><p>{lead}</p>
        <a className="button lightButton" href="/app/new" data-analytics-event="hero_cta" data-analytics-placement="seo_landing">{cta}</a></div>
        {visual && <figure className="seoHeroVisual"><img src={visual.src} alt={visual.alt} width="1200" height="800" /><figcaption>{visual.caption}</figcaption></figure>}
      </div>
    </section>
    <div className="seoContent shell">
      {sections.map((section) => <section key={section.title}><h2>{section.title}</h2><div>{section.body}</div></section>)}
      {faq.length > 0 && <section className="seoFaq"><h2>Частые вопросы</h2>{faq.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</section>}
      {related.length > 0 && <section className="seoRelated"><div><span className="eyebrow"><i /> Продолжите выбор</span><h2>Читайте по теме</h2></div><div className="seoRelatedGrid">{related.map((item) => <a key={item.href} href={item.href}><strong>{item.label}</strong><span>{item.description}</span><b>Открыть материал →</b></a>)}</div></section>}
      <aside className="seoConcept"><strong>Важно</strong><p>ВИЖУФАСАД создаёт концепцию внешнего вида. Это не рабочий строительный проект, не смета и не расчёт материалов.</p></aside>
    </div>
    <footer className="seoFooter shell"><a href="/gallery">Примеры</a><a href="/styles">Каталог стилей</a><a href="/visualizaciya-fasada-po-foto">Фасад по фото</a><a href="/stili-i-materialy-fasada">Стили и материалы</a><a href="/partners">Партнёрам</a><a href="/legal/privacy">Конфиденциальность</a></footer>
    <JsonLd data={{
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbItems.map((item, index) => ({
        "@type": "ListItem", position: index + 1, name: item.name,
        item: item.path === "/" ? siteOrigin : `${siteOrigin}${item.path}`,
      })),
    }} />
    {faq.length > 0 && <JsonLd data={{
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: faq.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })),
    }} />}
  </main>;
}
