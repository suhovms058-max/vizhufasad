import type { Metadata } from "next";
import { facadeStyles } from "../facadeStyleCatalog";
import { SeoLanding } from "../SeoLanding";

export const metadata: Metadata = {
  title: "Стили фасадов для визуализации дома — ВИЖУФАСАД",
  description: "10 направлений фасада: характер, материалы, палитры и демонстрационные примеры на одном доме.",
  alternates: { canonical: "/styles" },
};

export default function StylesPage() {
  return <SeoLanding path="/styles" breadcrumb="Стили" eyebrow="КАТАЛОГ СТИЛЕЙ" title="Выберите характер фасада, а не случайную красивую картинку" lead="Начните с направления, затем уточните материалы и цвета. Геометрия дома остаётся защищённой отдельными настройками." sections={[
    { title: "10 направлений на одном доме", body: <div className="styleIndexGrid">{facadeStyles.map((style) => <article key={style.slug}>
      <img src={style.image} alt={style.imageAlt} width="1200" height="900" loading="lazy" /><div><h3>{style.title}</h3><p>{style.summary}</p><a className="button ghost" href={`/styles/${style.slug}`}>Посмотреть стиль</a></div>
    </article>)}</div> },
    { title: "Сравнивайте отделку, а не разные здания", body: <p>Все направления показаны на одном и том же доме и в одном ракурсе. Поэтому различия в материалах, палитре и деталях не смешиваются с другой архитектурой или участком.</p> },
    { title: "Материал не равен стилю", body: <p>Один стиль можно собрать из разных сочетаний штукатурки, кирпича, клинкера, дерева, камня, панелей, фиброцемента и металла. ВИЖУФАСАД показывает визуальную концепцию, а техническую совместимость отделки с основанием нужно проверять отдельно.</p> },
  ]} cta="Примерить стиль к своему дому" />;
}
