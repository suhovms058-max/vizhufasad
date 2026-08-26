import type { Metadata } from "next";
import Image from "next/image";
import { facadeStyles } from "../facadeStyleCatalog";
import { JsonLd } from "../JsonLd";
import { SeoLanding } from "../SeoLanding";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://vizhufasad.ru";

export const metadata: Metadata = {
  title: "10 стилей фасадов дома: примеры, материалы и палитры",
  description: "Журнальный гид по 10 стилям фасадов: по три примера домов, особенности отделки, подходящие материалы и цветовые палитры.",
  alternates: { canonical: "/styles" },
};

const sectionTitles: Record<string, string> = {
  sovremennyy: "Современный стиль",
  minimalizm: "Стиль минимализм",
  skandinavskiy: "Скандинавский стиль",
  barnhaus: "Стиль барнхаус",
  shale: "Стиль шале",
  klassicheskiy: "Классический стиль",
  neoklassicheskiy: "Неоклассический стиль",
  kontemporari: "Стиль контемпорари",
  loft: "Стиль лофт",
  "temnyy-hay-tek": "Стиль тёмный хай-тек",
};

export default function StylesPage() {
  return <>
    <SeoLanding
      path="/styles"
      breadcrumb="Стили"
      eyebrow="ЖУРНАЛ ФАСАДНЫХ РЕШЕНИЙ"
      title="Десять направлений для внешнего облика дома"
      lead="Сравните разные типы домов в одном стиле, разберитесь в материалах и палитрах, а затем перенесите выбранный характер на фотографию своего фасада."
      cta="Примерить стиль к своему дому"
      className="styleJournalPage"
      sections={facadeStyles.map((style) => ({
        title: sectionTitles[style.slug] ?? `${style.title} стиль`,
        body: <article id={style.slug} className="styleJournalEntry">
          <div className="styleJournalIntro">
            <p className="styleJournalCharacter">{style.character}</p>
            <p className="styleJournalDeck">{style.summary}</p>
          </div>

          <div className="styleJournalGallery" aria-label={`Три примера фасадов в стиле «${style.title}»`}>
            {[1, 2, 3].map((imageIndex) => <figure className="styleJournalCard" key={imageIndex}>
              <div className="styleJournalMedia">
                <Image
                  src={`/facade-styles/${style.slug}-0${imageIndex}.webp`}
                  alt={`${style.title} фасад частного дома, пример ${imageIndex}`}
                  width={720}
                  height={1080}
                  sizes="(max-width: 720px) 82vw, (max-width: 1100px) 30vw, 370px"
                />
              </div>
              <span className="styleJournalCompass" aria-hidden="true">
                <svg viewBox="0 0 64 64" focusable="false">
                  <g className="styleJournalCompassSecondary">
                    <polygon className="styleJournalCompassCopperSoft" points="32,32 45,13 36,29" />
                    <polygon className="styleJournalCompassGraphiteSoft" points="32,32 45,13 35,35" />
                    <polygon className="styleJournalCompassCopperSoft" points="32,32 51,19 35,28" />
                    <polygon className="styleJournalCompassGraphiteSoft" points="32,32 51,19 37,34" />
                    <polygon className="styleJournalCompassCopperSoft" points="32,32 51,45 37,30" />
                    <polygon className="styleJournalCompassGraphiteSoft" points="32,32 51,45 35,36" />
                    <polygon className="styleJournalCompassCopperSoft" points="32,32 45,51 35,35" />
                    <polygon className="styleJournalCompassGraphiteSoft" points="32,32 45,51 29,36" />
                    <polygon className="styleJournalCompassCopperSoft" points="32,32 19,51 29,35" />
                    <polygon className="styleJournalCompassGraphiteSoft" points="32,32 19,51 28,29" />
                    <polygon className="styleJournalCompassCopperSoft" points="32,32 13,45 29,36" />
                    <polygon className="styleJournalCompassGraphiteSoft" points="32,32 13,45 27,30" />
                    <polygon className="styleJournalCompassCopperSoft" points="32,32 13,19 27,34" />
                    <polygon className="styleJournalCompassGraphiteSoft" points="32,32 13,19 29,28" />
                    <polygon className="styleJournalCompassCopperSoft" points="32,32 19,13 28,29" />
                    <polygon className="styleJournalCompassGraphiteSoft" points="32,32 19,13 35,28" />
                  </g>
                  <g className="styleJournalCompassPrimary">
                    <polygon className="styleJournalCompassCopper" points="32,32 32,2 26,27" />
                    <polygon className="styleJournalCompassGraphite" points="32,32 32,2 38,27" />
                    <polygon className="styleJournalCompassCopper" points="32,32 62,32 37,26" />
                    <polygon className="styleJournalCompassGraphite" points="32,32 62,32 37,38" />
                    <polygon className="styleJournalCompassCopper" points="32,32 32,62 38,37" />
                    <polygon className="styleJournalCompassGraphite" points="32,32 32,62 26,37" />
                    <polygon className="styleJournalCompassCopper" points="32,32 2,32 27,38" />
                    <polygon className="styleJournalCompassGraphite" points="32,32 2,32 27,26" />
                  </g>
                  <polygon className="styleJournalCompassCore" points="32,27 37,32 32,37 27,32" />
                </svg>
              </span>
              <span className="styleJournalBrand" aria-hidden="true"><b>ВФ</b></span>
            </figure>)}
          </div>
          <div className="styleJournalDots" aria-hidden="true"><i /><i /><i /></div>

          <div className="styleJournalCopy">
            {style.article.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>

          <dl className="styleJournalFacts">
            <div><dt>Материалы</dt><dd>{style.materials.join(" · ")}</dd></div>
            <div><dt>Палитра</dt><dd>{style.palette}</dd></div>
            <div><dt>Лучше всего подходит</dt><dd>{style.bestFor}</dd></div>
          </dl>
          <aside className="styleJournalNote"><strong>Что важно учесть</strong><p>{style.caution}</p></aside>
        </article>,
      }))}
    />
    <JsonLd data={{
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "10 стилей фасадов дома",
      url: `${siteOrigin}/styles`,
      hasPart: facadeStyles.map((style, index) => ({
        "@type": "Article",
        position: index + 1,
        headline: `${style.title} фасад дома`,
        description: style.summary,
        image: [1, 2, 3].map((imageIndex) => `${siteOrigin}/facade-styles/${style.slug}-0${imageIndex}.webp`),
        url: `${siteOrigin}/styles#${style.slug}`,
      })),
    }} />
  </>;
}
