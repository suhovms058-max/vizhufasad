import type { ReactNode } from "react";
import { Bodoni_Moda, Inter } from "next/font/google";
import "./globals.css";
import { JsonLd } from "./JsonLd";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://vizhufasad.ru";
const inter = Inter({
  subsets: ["cyrillic", "latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-inter",
});
const bodoni = Bodoni_Moda({
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
  variable: "--font-bodoni",
  preload: false,
  fallback: ["Georgia", "serif"],
  adjustFontFallback: false,
});

export const metadata = {
  metadataBase: new URL(siteOrigin),
  title: "Визуализация фасада дома по фото — ВИЖУФАСАД",
  description:
    "Загрузите фото дома, настройте стиль и материалы и получите автоматически проверенную концепцию фасада.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
    ],
    shortcut: "/favicon-32x32.png",
  },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    url: "/",
    siteName: "ВИЖУФАСАД",
    title: "Создайте дизайн фасада своего дома с помощью ИИ",
    description: "Сравните стили, материалы и цвета на фотографии своего дома.",
    images: [{ url: "/facade-after-bright.webp", width: 1200, height: 900, alt: "Пример визуализации фасада дома" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ВИЖУФАСАД — визуализация фасада по фото",
    description: "Сравните стили, материалы и цвета на фотографии своего дома.",
    images: ["/facade-after-bright.webp"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={`${inter.variable} ${bodoni.variable}`}>
      <body>{children}
        <JsonLd data={{
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "Organization", "@id": `${siteOrigin}/#organization`, name: "ВИЖУФАСАД", url: siteOrigin, email: "vizhufasad0058@bk.ru" },
            { "@type": "WebSite", "@id": `${siteOrigin}/#website`, url: siteOrigin, name: "ВИЖУФАСАД", alternateName: "Вижу фасад", publisher: { "@id": `${siteOrigin}/#organization` }, inLanguage: "ru-RU" },
          ],
        }} />
        <script src="/product-analytics.js" defer />
      </body>
    </html>
  );
}
