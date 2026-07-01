import type { Metadata, Viewport } from "next";
import { Work_Sans, Manrope } from "next/font/google";
import "./globals.css";

const workSans = Work_Sans({
  variable: "--font-work-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Beba Mais — Painel",
  description: "Atendimento e pedidos da Beba Mais Distribuidora.",
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
