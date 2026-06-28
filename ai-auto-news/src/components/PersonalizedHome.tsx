'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Post } from '@/types';
import PostCard from '@/components/PostCard';
import Pagination from '@/components/Pagination';
import OnboardingQuiz from '@/components/OnboardingQuiz';
import {
  getCategoryMeta,
  getReadingTime,
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
  const [showQuiz, setShowQuiz] = useState(false);

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

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const loaded = readPrefs();
      setPrefs(loaded);
      setReady(true);

      // Check if user has completed onboarding via API
      try {
        const res = await fetch('/api/preferences');
        if (res.ok) {
          const data = await res.json();
          if (data.onboarding_done === 0) {
            setShowQuiz(true);
          }
        } else {
          // No session — show quiz
          setShowQuiz(true);
        }
      } catch {
        // On first visit or error, show quiz
        setShowQuiz(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Listen for 'open-quiz' event from Header's Preferences button
  useEffect(() => {
    const handler = () => setShowQuiz(true);
    window.addEventListener('open-quiz', handler);
    return () => window.removeEventListener('open-quiz', handler);
  }, []);

  useEffect(() => {
    if (!ready) return;
    writePrefs(prefs);
  }, [prefs, ready]);

  const sections = groupPostsByCategory(allPosts, categories);

  const updatePrefs = (next: Partial<ReaderPrefs>) => {
    setPrefs((current) => ({ ...current, ...next, initialized: true }));
  };

  // Hero: first post or empty
  const heroPost = allPosts[0];
  const secondaryPosts = allPosts.slice(1, 4);

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* ── ONBOARDING QUIZ ───────────────────────────────────────────────── */}
      {showQuiz && (
        <OnboardingQuiz onComplete={() => setShowQuiz(false)} />
      )}

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      {heroPost ? (
        <section className="hero-section animate-fade-in-up">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <span className={`category-badge category-badge-${heroPost.category}`}>
              {getCategoryMeta(heroPost.category).label}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              {timeAgo(heroPost.createdAt)}
            </span>
          </div>
          <Link href={`/post/${heroPost.slug}`}>
            <h1 className="hero-title">{heroPost.title}</h1>
          </Link>
          <p className="hero-excerpt">{heroPost.summary}</p>
          <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              {getReadingTime(heroPost.content)} min read
            </span>
            <Link href={`/post/${heroPost.slug}`} style={{ color: 'var(--color-accent)', fontWeight: 600, fontSize: '0.875rem', textDecoration: 'none' }}>
              Read more →
            </Link>
          </div>
        </section>
      ) : (
        <EmptyState />
      )}

      {/* ── SECONDARY HEADLINES ───────────────────────────────────────────── */}
      {secondaryPosts.length > 0 && (
        <section style={{ marginBottom: '2.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
            {secondaryPosts.map((post, index) => (
              <PostCard key={post.id} post={post} index={index} />
            ))}
          </div>
        </section>
      )}

      {/* ── STATS STRIP ───────────────────────────────────────────────────── */}
      <section className="stats-strip animate-fade-in-up">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Articles</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.autoCount}</div>
          <div className="stat-label">AI Generated</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.lastGeneration ? timeAgo(stats.lastGeneration) : '—'}</div>
          <div className="stat-label">Last Published</div>
        </div>
      </section>

      {/* ── TUNE FEED ─────────────────────────────────────────────────────── */}
      {tuning && (
        <section className="tune-panel animate-fade-in">
          <div>
            <h2>Tune your feed</h2>
            <p>Pick categories and topics to personalize your experience.</p>
          </div>
          <div className="tune-options">
            {categories.map((category) => {
              const meta = getCategoryMeta(category);
              const active = prefs.categories.includes(category);
              return (
                <button
                  key={category}
                  type="button"
                  className={`choice-chip ${active ? 'active' : ''}`}
                  onClick={() => updatePrefs({ categories: toggle(prefs.categories, category) })}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
          <div className="tune-options">
            {allTags.map((topic) => (
              <button
                key={topic}
                type="button"
                className={`choice-chip ${prefs.topics.includes(topic) ? 'active' : ''}`}
                onClick={() => updatePrefs({ topics: toggle(prefs.topics, topic) })}
              >
                #{topic}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn-primary" onClick={() => setTuning(false)}>Apply</button>
            <button type="button" className="btn-ghost" onClick={() => updatePrefs(emptyPrefs())}>Reset</button>
          </div>
        </section>
      )}

      {/* ── CATEGORY SECTIONS ─────────────────────────────────────────────── */}
      {sections.map((section) => {
        const meta = getCategoryMeta(section.category);
        return (
          <section key={section.category} className="content-section category-block">
            <div className="section-heading">
              <div>
                <p style={{ color: meta.color }}>{meta.icon}</p>
                <h2>{meta.label}</h2>
              </div>
              <Link href={`/category/${section.category}`}>View all →</Link>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1.25rem' }}>
              {section.posts.map((post, index) => (
                <PostCard key={post.id} post={post} index={index} compact />
              ))}
            </div>
          </section>
        );
      })}

      {/* ── LATEST ────────────────────────────────────────────────────────── */}
      <section className="content-section">
        <div className="section-heading">
          <div>
            <h2>Latest</h2>
          </div>
          <button type="button" onClick={() => setTuning((v) => !v)}>Tune Feed</button>
        </div>
        {latestPosts.length === 0 ? (
          <div className="empty-state">
            <p>No articles yet.</p>
            <span>The AI correspondent is researching trending stories.</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.25rem' }}>
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

// ── Empty State ──────────────────────────────────────────────────────────────
function EmptyState() {
  const [schedulerStatus, setSchedulerStatus] = useState<{ running: boolean } | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/scheduler');
        if (res.ok) setSchedulerStatus(await res.json());
      } catch { /* ignore */ }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="hero-section animate-fade-in-up" style={{ textAlign: 'center', padding: '3rem 0' }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📰</div>
      <h1 style={{ fontFamily: 'var(--font-headline)', fontSize: '1.75rem', marginBottom: '0.5rem' }}>
        Your feed is being prepared
      </h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.95rem', marginBottom: '1.5rem', maxWidth: '480px', margin: '0 auto 1.5rem' }}>
        Our AI correspondent is researching trending Tech &amp; AI stories.
        Articles will appear here as they are generated.
      </p>
      {schedulerStatus?.running && (
        <div className="status-line" style={{ justifyContent: 'center' }}>
          <span className="pulse-dot" />
          <span>Auto-publishing is active — first articles in ~1 minute</span>
        </div>
      )}
      {!schedulerStatus?.running && (
        <Link href="/admin" className="btn-primary" style={{ marginTop: '1rem' }}>
          Open Admin Dashboard
        </Link>
      )}
    </section>
  );
}
