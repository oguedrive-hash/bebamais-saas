import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Fontes servidas pelo próprio painel (sem depender do Google Fonts no build).
const workSans = localFont({
  src: "../../node_modules/@fontsource-variable/work-sans/files/work-sans-latin-wght-normal.woff2",
  variable: "--font-work-sans",
  weight: "100 900",
  display: "swap",
});

const manrope = localFont({
  src: "../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  variable: "--font-manrope",
  weight: "200 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Atendimento - Beba Mais",
  description: "Painel de atendimento do Beba Mais Distribuidora.",
};

export const viewport: Viewport = {
  themeColor: "#CC1B1B",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${workSans.variable} ${manrope.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-body bg-offwhite text-preto">
        {children}
      </body>
    </html>
  );
}
