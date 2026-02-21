import { NextResponse } from 'next/server';
import { getAllPosts } from '@/db/posts';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://aiauto.news';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const { posts } = getAllPosts(1, 50);

  const items = posts
    .map((post) => {
      const link = `${BASE_URL}/post/${encodeURIComponent(post.slug)}`;
      const pubDate = new Date(post.createdAt).toUTCString();
      const description = escapeXml(post.summary);
      const title = escapeXml(post.title);
      const categories = post.tags
        .map((t) => `<category>${escapeXml(t)}</category>`)
        .join('\n      ');

      return `    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <description>${description}</description>
      <pubDate>${pubDate}</pubDate>
      ${categories}
      <source url="${BASE_URL}/rss.xml">AI Auto News</source>
    </item>`;
    })
    .join('\n');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AI Auto News</title>
    <link>${BASE_URL}</link>
    <description>Autonomous AI-powered technology news and analysis</description>
    <language>en-us</language>
    <managingEditor>editor@aiauto.news (AI Auto News)</managingEditor>
    <webMaster>admin@aiauto.news (AI Auto News)</webMaster>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <ttl>30</ttl>
    <atom:link href="${BASE_URL}/rss.xml" rel="self" type="application/rss+xml" />
    <image>
      <url>${BASE_URL}/favicon.ico</url>
      <title>AI Auto News</title>
      <link>${BASE_URL}</link>
    </image>
${items}
  </channel>
</rss>`;

  return new NextResponse(rss, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    },
  });
}
