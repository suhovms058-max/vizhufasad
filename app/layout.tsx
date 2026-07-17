import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Визуализация фасада дома по фото — ВИЖУФАСАД",
  description:
    "Загрузите фото дома и получите варианты отделки фасада. От быстрой AI-визуализации до подбора материалов и PDF для строителей.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
