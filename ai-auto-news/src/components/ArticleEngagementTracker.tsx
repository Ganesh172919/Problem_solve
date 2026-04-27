'use client';

import { useEffect } from 'react';

const STORAGE_KEY = 'ai-auto-news.reader';

export default function ArticleEngagementTracker({
  slug,
  category,
  tags,
}: {
  slug: string;
  category: string;
  tags: string[];
}) {
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const current = raw ? JSON.parse(raw) : {};
      const readSlugs = Array.from(new Set([slug, ...(current.readSlugs || [])])).slice(0, 80);
      const categories = Array.from(new Set([category, ...(current.categories || [])])).slice(0, 12);
      const topics = Array.from(new Set([...(current.topics || []), ...tags])).slice(0, 24);
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...current,
          initialized: true,
          readSlugs,
          categories,
          topics,
        }),
      );
    } catch {
      // Reader personalization is optional and should never block article rendering.
    }
  }, [category, slug, tags]);

  return null;
}
