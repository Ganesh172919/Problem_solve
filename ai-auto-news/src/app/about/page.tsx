import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About',
  description: 'Learn about the AI Auto News personalized AI publishing platform.',
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-10">
        <p className="status-line">Autonomous publishing platform</p>
        <h1 className="text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          About AI Auto News
        </h1>
        <p className="text-lg" style={{ color: 'var(--text-secondary)', lineHeight: '1.7' }}>
          AI Auto News combines automated publishing with a reader-tuned website. The goal is broad coverage in clear topic blocks, with source visibility and local personalization that does not require an account.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {[
          {
            title: 'Autonomous newsroom',
            body: 'The publishing pipeline researches topics, generates articles, formats content, and stores posts in SQLite for the public site.',
          },
          {
            title: 'Personalized reader',
            body: 'Topic choices, reading history, dismissed posts, and recent searches stay in browser storage and tune the For You feed.',
          },
          {
            title: 'Visible trust signals',
            body: 'Article pages show source counts, AI disclosure, tags, reading time, and quality signals so readers know how to treat each post.',
          },
          {
            title: 'Local-first platform',
            body: 'The current product runs locally with Next.js, React, TypeScript, and better-sqlite3 while keeping experimental platform APIs isolated.',
          },
        ].map((item) => (
          <section key={item.title} className="card p-6">
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{item.title}</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: '1.7' }}>{item.body}</p>
          </section>
        ))}
      </div>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <p>Important note</p>
            <h2>AI-assisted content</h2>
          </div>
        </div>
        <div className="card p-6">
          <p style={{ color: 'var(--text-secondary)', lineHeight: '1.7' }}>
            AI-generated content can contain errors, stale context, or incomplete sourcing. Use the visible references and trust panel as reading aids, and verify important claims from primary sources.
          </p>
        </div>
      </section>
    </div>
  );
}
