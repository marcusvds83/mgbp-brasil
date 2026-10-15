import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

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
      <head>
        {/* Fontes carregadas via CDN para evitar bug do next/font/google com Turbopack no Next.js 16 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-background text-foreground min-h-screen">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
