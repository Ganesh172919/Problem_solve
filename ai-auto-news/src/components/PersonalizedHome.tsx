'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Post } from '@/types';
import PostCard from '@/components/PostCard';
import Pagination from '@/components/Pagination';
import {
  getCategoryMeta,
  groupPostsByCategory,
  timeAgo,
} from '@/lib/postPresentation';

interface ReaderPrefs {
  categories: string[];
  topics: string[];
  dismissedSlugs: string[];
  readSlugs: string[];
  recentSearches: string[];
  initialized: boolean;
}

interface PersonalizedResult {
  slug: string;
  reason: string;
}

const STORAGE_KEY = 'ai-auto-news.reader';

function emptyPrefs(): ReaderPrefs {
  return {
    categories: [],
    topics: [],
    dismissedSlugs: [],
    readSlugs: [],
    recentSearches: [],
    initialized: false,
  };
}

function readPrefs(): ReaderPrefs {
  if (typeof window === 'undefined') return emptyPrefs();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyPrefs();
    return { ...emptyPrefs(), ...JSON.parse(raw), initialized: true };
  } catch {
    return emptyPrefs();
  }
}

function writePrefs(prefs: ReaderPrefs) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prefs, initialized: true }));
}

function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export default function PersonalizedHome({
  latestPosts,
  allPosts,
  categories,
  stats,
  currentPage,
  totalPages,
}: {
  latestPosts: Post[];
  allPosts: Post[];
  categories: string[];
  stats: { total: number; autoCount: number; lastGeneration: string | null };
  currentPage: number;
  totalPages: number;
}) {
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => emptyPrefs());
  const [ready, setReady] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [personalized, setPersonalized] = useState<PersonalizedResult[]>([]);

  const allTags = useMemo(() => {
    const stopwords = new Set(['and', 'for', 'the', 'with', 'from', 'best', 'tips', 'guide']);
    const counts = new Map<string, number>();
    allPosts.forEach((post) => {
      post.tags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 2 && !stopwords.has(tag.toLowerCase()))
        .forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag]) => tag);
  }, [allPosts]);

  const postBySlug = useMemo(() => {
    const map = new Map<string, Post>();
    allPosts.forEach((post) => map.set(post.slug, post));
    return map;
  }, [allPosts]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const loaded = readPrefs();
      setPrefs(loaded);
      setTuning(!loaded.initialized);
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready) return;
    writePrefs(prefs);
  }, [prefs, ready]);

  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams({
      view: 'personalized',
      topics: [...prefs.topics, ...prefs.recentSearches].join(','),
      categories: prefs.categories.join(','),
      exclude: prefs.dismissedSlugs.join(','),
      limit: '6',
    });
    fetch(`/api/recommendations?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setPersonalized(
          (data?.recommendations || []).map((item: { slug: string; reason: string }) => ({
            slug: item.slug,
            reason: item.reason,
          })),
        );
      })
      .catch(() => setPersonalized([]));
  }, [prefs.categories, prefs.dismissedSlugs, prefs.recentSearches, prefs.topics, ready]);

  const reasons = new Map(personalized.map((item) => [item.slug, item.reason]));
  const forYouPosts = personalized
    .map((item) => postBySlug.get(item.slug))
    .filter((post): post is Post => Boolean(post))
    .slice(0, 6);
  const fallbackForYou = allPosts
    .filter((post) => !prefs.dismissedSlugs.includes(post.slug))
    .slice(0, 6);
  const topStories = allPosts
    .filter((post) => post.sourceReferences.length > 0 || post.tags.length >= 3)
    .slice(0, 6);
  const sections = groupPostsByCategory(allPosts, categories);

  const updatePrefs = (next: Partial<ReaderPrefs>) => {
    setPrefs((current) => ({ ...current, ...next, initialized: true }));
  };

  const dismiss = (slug: string) => {
    updatePrefs({ dismissedSlugs: [...new Set([...prefs.dismissedSlugs, slug])] });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="home-hero animate-fade-in-up">
        <div>
          <div className="status-line">
            <span className="pulse-dot" />
            <span>Auto-publishing active</span>
          </div>
          <h1 className="home-title">AI Auto News</h1>
          <p className="home-subtitle">
            A personalized AI-powered news desk for broad information coverage, organized by topic and tuned to what you read.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/search" className="btn-primary">Search Articles</Link>
            <button type="button" className="btn-ghost" onClick={() => setTuning((value) => !value)}>
              Tune Feed
            </button>
            <Link href="/rss.xml" className="btn-ghost" target="_blank">RSS</Link>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="signal-grid">
            {['AI', 'Tech', 'Business', 'Sports', 'World', 'Ideas'].map((label, index) => (
              <span key={label} style={{ animationDelay: `${index * 0.08}s` }}>{label}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="stats-strip animate-fade-in-up">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total Posts</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.autoCount}</div>
          <div className="stat-label">AI Assisted</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.lastGeneration ? timeAgo(stats.lastGeneration) : 'None'}</div>
          <div className="stat-label">Last Published</div>
        </div>
      </section>

      {tuning && (
        <section className="tune-panel animate-fade-in">
          <div>
            <h2>Tune your feed</h2>
            <p>Pick categories and topics. Preferences stay in this browser only.</p>
          </div>
          <div className="tune-options">
            {categories.map((category) => {
              const meta = getCategoryMeta(category);
              const active = prefs.categories.includes(category);
              return (
                <button
                  key={category}
                  type="button"
                  className={active ? 'choice-chip active' : 'choice-chip'}
                  onClick={() => updatePrefs({ categories: toggle(prefs.categories, category) })}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
          <div className="tune-options">
            {allTags.map((topic) => {
              const active = prefs.topics.includes(topic);
              return (
                <button
                  key={topic}
                  type="button"
                  className={active ? 'choice-chip active' : 'choice-chip'}
                  onClick={() => updatePrefs({ topics: toggle(prefs.topics, topic) })}
                >
                  #{topic}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => setTuning(false)}>Apply</button>
            <button type="button" className="btn-ghost" onClick={() => updatePrefs(emptyPrefs())}>Reset</button>
          </div>
        </section>
      )}

      <section className="content-section">
        <div className="section-heading">
          <div>
            <p>Personalized</p>
            <h2>For You</h2>
          </div>
          <button type="button" className="btn-ghost" onClick={() => setTuning(true)}>Adjust</button>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {(forYouPosts.length > 0 ? forYouPosts : fallbackForYou).map((post, index) => (
            <div key={post.id} className="recommendation-wrap">
              <PostCard post={post} index={index} reason={reasons.get(post.slug)} />
              <button type="button" className="hide-link" onClick={() => dismiss(post.slug)}>
                Hide from For You
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <p>Verified signals</p>
            <h2>Top Stories</h2>
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {(topStories.length > 0 ? topStories : allPosts.slice(0, 6)).map((post, index) => (
            <PostCard key={post.id} post={post} index={index} compact />
          ))}
        </div>
      </section>

      {sections.map((section) => {
        const meta = getCategoryMeta(section.category);
        return (
          <section key={section.category} className="content-section category-block">
            <div className="section-heading">
              <div>
                <p style={{ color: meta.color }}>{meta.icon}</p>
                <h2>{meta.label}</h2>
                <span>{meta.description}</span>
              </div>
              <Link href={`/category/${section.category}`} className="btn-ghost">View all</Link>
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {section.posts.map((post, index) => (
                <PostCard key={post.id} post={post} index={index} compact />
              ))}
            </div>
          </section>
        );
      })}

      <section className="content-section">
        <div className="section-heading">
          <div>
            <p>Chronological</p>
            <h2>Latest</h2>
          </div>
        </div>
        {latestPosts.length === 0 ? (
          <div className="empty-state">
            <p>No posts yet.</p>
            <span>The AI publisher will add coverage shortly.</span>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {latestPosts.map((post, index) => (
              <PostCard key={post.id} post={post} index={index} />
            ))}
          </div>
        )}
        <Pagination currentPage={currentPage} totalPages={totalPages} />
      </section>
    </div>
  );
}
