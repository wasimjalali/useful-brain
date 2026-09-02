import type { Metadata } from "next";
import { JetBrains_Mono, Nunito } from "next/font/google";

import "./globals.css";

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Useful Brain",
  description:
    "Private company knowledge grounded in evidence the operator can inspect.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${nunito.variable} ${jetBrainsMono.variable}`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
