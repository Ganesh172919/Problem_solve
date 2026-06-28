import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About',
  description: 'Learn about TechPulse AI — the autonomous AI journalism platform.',
};

export default function AboutPage() {
  return (
    <div style={{ maxWidth: 'var(--content-width)', margin: '0 auto', padding: '2rem 1rem' }}>
      <div style={{ marginBottom: '2.5rem' }}>
        <p className="status-line">Autonomous publishing platform</p>
        <h1 style={{ fontFamily: 'var(--font-headline)', fontSize: '2rem', fontWeight: 700, marginBottom: '1rem' }}>
          About TechPulse AI
        </h1>
        <p style={{ fontSize: '1.0625rem', color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
          TechPulse AI is a fully autonomous Tech &amp; AI news publishing platform.
          An AI agent pipeline researches trending topics, generates articles using
          Google Gemini, validates quality, and publishes content — all without human intervention.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' }}>
        {[
          {
            title: '6-Agent Pipeline',
            body: 'Research → Template Select → Write → Quality Check → Publish. Each step is handled by a specialized AI agent with structured logging.',
          },
          {
            title: '5 Content Templates',
            body: 'Breaking news, deep analysis, weekly roundups, product reviews, and research explainers — each with tailored prompts and length targets.',
          },
          {
            title: 'Gemini Model Rotation',
            body: 'Uses 4 free-tier Gemini models with automatic fallback on rate limits. Response caching prevents duplicate API calls.',
          },
          {
            title: 'Personalized Feed',
            body: 'An onboarding quiz captures your preferred topics, tone, and frequency. The agent pipeline uses these to tailor content generation.',
          },
        ].map((item) => (
          <div key={item.title} className="card" style={{ padding: '1.25rem' }}>
            <h2 style={{ fontFamily: 'var(--font-headline)', fontSize: '1.0625rem', fontWeight: 700, marginBottom: '0.5rem' }}>{item.title}</h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{item.body}</p>
          </div>
        ))}
      </div>

      <section className="content-section">
        <div className="section-heading">
          <h2>Important note</h2>
        </div>
        <div className="card" style={{ padding: '1.25rem' }}>
          <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
            AI-generated content can contain errors, stale context, or incomplete sourcing.
            Each article includes trust signals (source count, AI disclosure, quality score)
            to help you evaluate credibility. Always verify important claims from primary sources.
          </p>
        </div>
      </section>
    </div>
  );
}
