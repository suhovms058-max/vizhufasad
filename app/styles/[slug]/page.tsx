import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { facadeStyleBySlug, facadeStyles } from "../../facadeStyleCatalog";
import { JsonLd } from "../../JsonLd";
import { SeoLanding } from "../../SeoLanding";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://vizhufasad.ru";

export function generateStaticParams() {
  return facadeStyles.map((style) => ({ slug: style.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const style = facadeStyleBySlug.get(slug);
  if (!style) return {};
  return {
    title: `${style.title} фасад дома — материалы и пример`,
    description: `${style.summary} Материалы: ${style.materials.join(", ")}.`,
    alternates: { canonical: `/styles/${style.slug}` },
    openGraph: { images: [{ url: style.image, alt: style.imageAlt }] },
  };
}

export default async function StyleDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const style = facadeStyleBySlug.get(slug);
  if (!style) notFound();
  return <>
    <SeoLanding path={`/styles/${style.slug}`} breadcrumb={style.title} parentBreadcrumb={{ name: "Стили", path: "/styles" }} eyebrow="СТИЛЬ ФАСАДА" title={`${style.title} фасад: материалы, палитра и характер`} lead={style.summary} sections={[
      { title: "Демонстрационный пример", body: <figure className="styleDetailFigure"><img src={style.image} alt={style.imageAlt} width="1200" height="900" /><figcaption>Один из возможных вариантов. Исходная геометрия дома сохраняется настройками проекта.</figcaption></figure> },
      { title: "Из чего складывается образ", body: <dl className="styleDefinition"><div><dt>Материалы</dt><dd>{style.materials.join(", ")}</dd></div><div><dt>Палитра</dt><dd>{style.palette}</dd></div><div><dt>Характер</dt><dd>{style.character}</dd></div></dl> },
      { title: "Кому подойдёт", body: <p>{style.bestFor}</p> },
      { title: "Что можно уточнить генератору", body: <p>Укажите желаемые оттенки, распределение материалов, отделку цоколя, карниза и существующих опор. Ограничения на окна, двери, кровлю, этажность и положение дома остаются включёнными по умолчанию.</p> },
    ]} cta={`Примерить стиль «${style.title}»`} />
    <JsonLd data={{
      "@context": "https://schema.org", "@type": "ImageObject", name: `${style.title} фасад дома`,
      contentUrl: `${siteOrigin}${style.image}`, url: `${siteOrigin}/styles/${style.slug}`, caption: style.summary,
      representativeOfPage: true,
    }} />
  </>;
}
