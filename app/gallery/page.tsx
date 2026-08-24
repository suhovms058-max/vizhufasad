import type { Metadata } from "next";
import { facadeStyles } from "../facadeStyleCatalog";
import { JsonLd } from "../JsonLd";
import { SeoLanding } from "../SeoLanding";
import { GalleryCases } from "../GalleryCases";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://vizhufasad.ru";

export const metadata: Metadata = {
  title: "Примеры визуализации фасадов одного дома — ВИЖУФАСАД",
  description: "Сравните современный, скандинавский и неоклассический варианты отделки одного дома при сохранении его геометрии.",
  alternates: { canonical: "/gallery" },
};

export default function GalleryPage() {
  return <>
    <SeoLanding path="/gallery" breadcrumb="Примеры" eyebrow="ДЕМОНСТРАЦИОННАЯ ГАЛЕРЕЯ" title="Один дом — три разных характера фасада" lead="Все примеры построены на одном исходном доме. Так легче оценить именно отделку, палитру и настроение, а не разницу в архитектуре." sections={[
      { title: "Сравните направления", body: <GalleryCases /> },
      { title: "Что здесь можно сравнить", body: <ul><li>Как меняется впечатление от одного дома при другой палитре.</li><li>Где дерево, штукатурка, камень и декор работают как акценты.</li><li>Как сохранить окна, двери, кровлю, этажность и положение дома.</li></ul> },
      { title: "Ваш результат будет другим", body: <p>Эти изображения показывают возможности сервиса, но не являются шаблонами. Генератор получает фотографию именно вашего дома, выбранные материалы, цвета, пожелания и ограничения.</p> },
    ]} cta="Загрузить фото своего дома" />
    <JsonLd data={{
      "@context": "https://schema.org", "@type": "ItemList", name: "Примеры визуализации фасадов",
      itemListElement: facadeStyles.map((style, index) => ({
        "@type": "ListItem", position: index + 1, url: `${siteOrigin}/styles/${style.slug}`,
        item: { "@type": "ImageObject", name: `${style.title} фасад`, contentUrl: `${siteOrigin}${style.image}`, caption: style.summary },
      })),
    }} />
  </>;
}
