import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Очередь 420604",
  description: "Очередь на сдачу лабораторных и практических работ группы 420604",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
