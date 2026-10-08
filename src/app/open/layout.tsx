import { Geist } from "next/font/google";

const geistOpen = Geist({
  subsets: ["latin"],
  variable: "--font-geist-open",
  display: "swap",
});

export default function OpenLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      className={`open-scope ${geistOpen.variable} flex min-h-full flex-1 flex-col bg-canvas text-ink`}
      data-theme="light"
      style={{
        fontFamily:
          'var(--font-geist-open), ui-sans-serif, system-ui, sans-serif',
        ["--font-ui" as string]:
          'var(--font-geist-open), ui-sans-serif, system-ui, sans-serif',
      }}
    >
      {children}
    </div>
  );
}
