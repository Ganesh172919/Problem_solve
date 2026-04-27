import { NextResponse } from 'next/server';
import { getAllPosts, getCategories } from '@/db/posts';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const { posts } = getAllPosts(1, 1000);
  const categories = getCategories();

  const urls: { loc: string; changefreq: string; priority: string; lastmod?: string }[] = [
    { loc: BASE_URL, changefreq: 'hourly', priority: '1.0' },
    { loc: `${BASE_URL}/about`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${BASE_URL}/search`, changefreq: 'weekly', priority: '0.6' },
    ...categories.map((category) => ({
      loc: `${BASE_URL}/category/${encodeURIComponent(category)}`,
      changefreq: 'hourly',
      priority: '0.7',
    })),
    ...posts.map((post) => ({
      loc: `${BASE_URL}/post/${encodeURIComponent(post.slug)}`,
      lastmod: post.updatedAt,
      changefreq: 'weekly',
      priority: '0.8',
    })),
  ];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${escapeXml(url.loc)}</loc>
    ${url.lastmod ? `<lastmod>${escapeXml(url.lastmod)}</lastmod>` : ''}
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>`;

  return new NextResponse(sitemap, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    },
  });
}
