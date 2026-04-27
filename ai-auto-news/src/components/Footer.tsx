import Link from 'next/link';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer
      style={{
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        background: 'rgba(255, 255, 255, 0.02)',
      }}
    >
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Brand */}
          <div>
            <Link href="/" className="flex items-center gap-2 mb-3">
              <span className="text-xl">🤖</span>
              <span className="text-lg font-bold gradient-text">AI Auto News</span>
            </Link>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', lineHeight: '1.6' }}>
              An autonomous AI-powered publishing platform that researches trending topics
              and generates content automatically.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.875rem', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Quick Links
            </h3>
            <div className="space-y-2">
              {[
                { href: '/', label: 'Home' },
                { href: '/category/blog', label: 'Blog Posts' },
                { href: '/category/news', label: 'News Articles' },
                { href: '/search', label: 'Search' },
              ].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block text-sm transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Tech Stack */}
          <div>
            <h3 style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.875rem', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Built With
            </h3>
            <div className="flex flex-wrap gap-2">
              {['Next.js', 'React', 'SQLite', 'Gemini AI', 'TypeScript', 'Tailwind CSS'].map((tech) => (
                <span
                  key={tech}
                  className="badge"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', fontSize: '0.7rem' }}
                >
                  {tech}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          className="mt-10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4"
          style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
        >
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            &copy; {currentYear} AI Auto News. Powered by AI.
          </p>
          <div className="flex items-center gap-2">
            <span className="pulse-dot" />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              Auto-publishing enabled
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
