import Link from 'next/link';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '1.5rem', marginBottom: '1rem' }}>
          <Link href="/">Home</Link>
          <Link href="/category/ai">AI</Link>
          <Link href="/category/tech">Tech</Link>
          <Link href="/category/startups">Startups</Link>
          <Link href="/category/research">Research</Link>
          <Link href="/search">Search</Link>
          <Link href="/admin">Admin</Link>
          <Link href="/rss.xml">RSS</Link>
        </div>
        <p>
          &copy; {currentYear} TechPulse AI — Autonomous AI Journalism.
          All content is AI-generated via Gemini.
        </p>
      </div>
    </footer>
  );
}
