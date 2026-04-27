import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "AI Auto News — Autonomous AI Publishing Platform",
  description:
    "An autonomous AI-powered blog and news platform that researches trending topics, generates content, and publishes automatically.",
  openGraph: {
    title: "AI Auto News",
    description: "Autonomous AI-Powered Publishing Platform",
    type: "website",
    url: "http://localhost:3000",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="antialiased min-h-screen flex flex-col"
        style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
      >
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
