import type { MetadataRoute } from "next";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://vizhufasad.ru";
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app/", "/auth/", "/api/", "/internal/"] },
    sitemap: `${siteOrigin}/sitemap.xml`,
  };
}
