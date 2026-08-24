import type { ReactNode } from "react";
import { JsonLd } from "./JsonLd";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://vizhufasad.ru";

type Section = { title: string; body: ReactNode };

export function SeoLanding({
  eyebrow, title, lead, sections, path, breadcrumb, parentBreadcrumb, cta = "Попробовать бесплатно",
}: {
  eyebrow: string;
  title: string;
  lead: string;
  sections: Section[];
  path: string;
  breadcrumb: string;
  parentBreadcrumb?: { name: string; path: string };
  cta?: string;
}) {
  const breadcrumbItems = [
    { name: "Главная", path: "/" },
    ...(parentBreadcrumb ? [parentBreadcrumb] : []),
    { name: breadcrumb, path },
  ];
  return <main className="seoPage">
    <header className="seoHeader shell">
      <a className="logo" href="/"><span className="logoMark">ВФ</span><span>ВИЖУФАСАД<small>AI-ВИЗУАЛИЗАЦИЯ ФАСАДОВ</small></span></a>
      <nav aria-label="Основная навигация"><a href="/gallery">Примеры</a><a href="/styles">Стили</a><a href="/#pricing">Тарифы</a><a className="seoHeaderCta" href="/app/new">Создать проект</a></nav>
    </header>
    <section className="seoHero">
      <div className="shell"><nav className="seoBreadcrumb" aria-label="Хлебные крошки">{breadcrumbItems.map((item, index) => <span key={item.path}>{index > 0 && <i aria-hidden="true">/</i>}{index < breadcrumbItems.length - 1 ? <a href={item.path}>{item.name}</a> : <span>{item.name}</span>}</span>)}</nav><div className="eyebrow light"><span /> {eyebrow}</div><h1>{title}</h1><p>{lead}</p>
        <a className="button lightButton" href="/app/new" data-analytics-event="hero_cta" data-analytics-placement="seo_landing">{cta}</a>
      </div>
    </section>
    <div className="seoContent shell">
      {sections.map((section) => <section key={section.title}><h2>{section.title}</h2><div>{section.body}</div></section>)}
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
  </main>;
}
