export type FacadeStyle = {
  slug: string;
  title: string;
  image: string;
  imageAlt: string;
  summary: string;
  materials: string[];
  palette: string;
  character: string;
  bestFor: string;
};

export const facadeStyles: FacadeStyle[] = [
  {
    slug: "sovremennyy",
    title: "Современный",
    image: "/facade-after-bright.webp",
    imageAlt: "Современный фасад того же двухэтажного дома со светлой штукатуркой и деревянным акцентом",
    summary: "Спокойная геометрия, крупные цельные плоскости и один тёплый акцент вместо лишнего декора.",
    materials: ["светлая штукатурка", "натуральное дерево", "графитовый металл"],
    palette: "Тёплый белый, натуральное дерево, графит",
    character: "Лаконичный и тёплый",
    bestFor: "Домов простой формы, где нужно освежить отделку и подчеркнуть входную группу.",
  },
  {
    slug: "skandinavskiy",
    title: "Скандинавский",
    image: "/facade-scandinavian-bright.webp",
    imageAlt: "Скандинавский фасад того же двухэтажного дома с деревом и светлой отделкой",
    summary: "Светлая основа, заметная фактура дерева и естественная палитра без холодной стерильности.",
    materials: ["деревянный планкен", "светлая штукатурка", "камень для цоколя"],
    palette: "Молочный, древесный, серо-каменный",
    character: "Светлый и природный",
    bestFor: "Загородных домов, которым нужен уютный фасад и визуальная связь с участком.",
  },
  {
    slug: "neoklassicheskiy",
    title: "Неоклассический",
    image: "/facade-neoclassical-bright.webp",
    imageAlt: "Неоклассический фасад того же двухэтажного дома со светлым камнем и сдержанным декором",
    summary: "Светлая минеральная отделка, выверенные обрамления и более торжественная входная группа.",
    materials: ["декоративная штукатурка", "светлый камень", "архитектурный декор"],
    palette: "Слоновая кость, песочный, тёмная бронза",
    character: "Сдержанный и представительный",
    bestFor: "Домов с симметричными окнами и владельцев, которым близка классика без перегруженности.",
  },
];

export const facadeStyleBySlug = new Map(facadeStyles.map((style) => [style.slug, style]));
