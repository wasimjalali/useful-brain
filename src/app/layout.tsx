import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";

import { ScrollChrome } from "@/components/ui/scroll-chrome";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

import "./globals.css";

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
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
      className={`h-full antialiased ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <ScrollChrome />
        {children}
      </body>
    </html>
  );
}
