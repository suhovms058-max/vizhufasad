import type { MetadataRoute } from "next";
import { facadeStyles } from "./facadeStyleCatalog";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://vizhufasad.ru";
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteOrigin, changeFrequency: "weekly", priority: 1 },
    { url: `${siteOrigin}/visualizaciya-fasada-po-foto`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${siteOrigin}/stili-i-materialy-fasada`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteOrigin}/partners`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${siteOrigin}/gallery`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteOrigin}/styles`, changeFrequency: "monthly", priority: 0.8 },
    ...facadeStyles.map((style) => ({ url: `${siteOrigin}/styles/${style.slug}`, changeFrequency: "monthly" as const, priority: 0.7 })),
  ];
}
