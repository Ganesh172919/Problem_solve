import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'AI Auto News - Personalized AI-Powered News',
    template: '%s | AI Auto News',
  },
  description:
    'A personalized AI-powered news website with broad topic coverage, source visibility, and anonymous reader preferences.',
  openGraph: {
    title: 'AI Auto News',
    description: 'Personalized AI-powered news with visible trust signals.',
    type: 'website',
    url: BASE_URL,
  },
  alternates: {
    canonical: BASE_URL,
    types: {
      'application/rss+xml': `${BASE_URL}/rss.xml`,
    },
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
        className={`${inter.className} antialiased min-h-screen flex flex-col`}
        style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
      >
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
