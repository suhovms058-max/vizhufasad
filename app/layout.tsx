import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Визуализация фасада дома по фото — ВИЖУФАСАД",
  description:
    "Загрузите фото дома, настройте стиль и материалы и получите автоматически проверенную концепцию фасада.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
