import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const interSans = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "NF-e MGBP Brasil - Fiscal Cloud",
  description:
    "Middleware de emissao propria de NF-e para MGBP Brasil (eletrodomesticos importados). Integra Odoo + SEFAZ com certificado A1.",
  keywords: ["NF-e", "MGBP Brasil", "Odoo", "SEFAZ", "Fiscal", "ERP", "Importacao"],
  authors: [{ name: "NFE-MGBP-Brasil" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className="dark">
      <body
        className={`${interSans.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground min-h-screen`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
