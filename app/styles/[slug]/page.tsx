import { notFound, permanentRedirect } from "next/navigation";
import { facadeStyleBySlug, facadeStyles } from "../../facadeStyleCatalog";

export function generateStaticParams() {
  return facadeStyles.map((style) => ({ slug: style.slug }));
}

export default async function StyleDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!facadeStyleBySlug.has(slug)) notFound();
  permanentRedirect(`/styles#${slug}`);
}
