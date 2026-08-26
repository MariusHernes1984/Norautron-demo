import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Norautron Analytics",
  description: "Syntetisk produksjons-, salgs- og kvalitetsanalyse med GPT-5.6-Terra."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nb">
      <body>{children}</body>
    </html>
  );
}
