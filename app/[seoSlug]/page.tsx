import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeoLanding } from "../SeoLanding";
import { getSeoPage, seoPages } from "../seoLandingPages";

export const dynamicParams = false;

export function generateStaticParams() {
  return seoPages.map(({ slug }) => ({ seoSlug: slug }));
}

type PageProps = { params: Promise<{ seoSlug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { seoSlug } = await params;
  const page = getSeoPage(seoSlug);
  if (!page) return {};
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `/${page.slug}` },
    openGraph: { title: page.title, description: page.description, url: `/${page.slug}`, images: [{ url: page.visual.src, width: 1200, height: 800, alt: page.visual.alt }] },
  };
}

export default async function SeoPage({ params }: PageProps) {
  const { seoSlug } = await params;
  const page = getSeoPage(seoSlug);
  if (!page) notFound();
  const currentIndex = seoPages.findIndex((candidate) => candidate.slug === page.slug);
  const related = [1, 2, 4].map((offset) => seoPages[(currentIndex + offset) % seoPages.length]).map((candidate) => ({ href: `/${candidate.slug}`, label: candidate.breadcrumb, description: candidate.lead }));
  return <SeoLanding path={`/${page.slug}`} breadcrumb={page.breadcrumb} eyebrow={page.eyebrow} title={page.h1} lead={page.lead} visual={page.visual} sections={page.sections} faq={page.faq} related={related} journal journalTitle={page.journalTitle} journalIntro={page.journalIntro} readTime={page.readTime} />;
}
