import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gestão Energética Residencial",
  description: "Dashboard de consumo residencial com cadastro manual de medições.",
  other: {
    "codex-preview": "development",
  },
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
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
