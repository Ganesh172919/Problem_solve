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
      <body
        className="antialiased min-h-screen flex flex-col bg-gray-50"
      >
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
