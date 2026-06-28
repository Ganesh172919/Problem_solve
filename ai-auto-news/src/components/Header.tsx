'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * openPreferences — dispatches a custom event that PersonalizedHome listens for
 * to re-open the onboarding quiz.
 */
function openPreferences() {
  window.dispatchEvent(new CustomEvent('open-quiz'));
}

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  const links = [
    { href: '/', label: 'Latest' },
    { href: '/category/ai', label: 'AI' },
    { href: '/category/tech', label: 'Tech' },
    { href: '/category/startups', label: 'Startups' },
    { href: '/category/research', label: 'Research' },
    { href: '/search', label: 'Search', icon: true },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header className={`site-header ${scrolled ? 'scrolled' : ''}`}>
      <div className="header-inner">
        <Link href="/" className="site-logo">
          TechPulse AI
        </Link>

        <nav className="nav-links">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link ${isActive(link.href) ? 'active' : ''}`}
            >
              {link.icon && (
                <svg
                  style={{ width: '14px', height: '14px', display: 'inline', marginRight: '4px' }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              )}
              {link.label}
            </Link>
          ))}

          <span style={{ width: '1px', height: '20px', background: 'var(--color-border)', margin: '0 4px' }} />

          <button
            type="button"
            className="nav-link"
            onClick={openPreferences}
            title="Customize your feed"
          >
            ⚙️ Preferences
          </button>

          <Link href="/admin" className="btn-primary" style={{ padding: '6px 16px', fontSize: '0.8rem' }}>
            Admin
          </Link>
        </nav>

        <button
          type="button"
          className="md:hidden"
          style={{ color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: '8px' }}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle navigation"
        >
          <svg style={{ width: '24px', height: '24px' }} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            {mobileMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            )}
          </svg>
        </button>
      </div>

      {mobileMenuOpen && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '0.5rem 1rem 1rem' }}>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link ${isActive(link.href) ? 'active' : ''}`}
              style={{ display: 'block', padding: '0.625rem 0' }}
              onClick={() => setMobileMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <button
            type="button"
            className="nav-link"
            style={{ display: 'block', padding: '0.625rem 0', width: '100%', textAlign: 'left' }}
            onClick={() => { openPreferences(); setMobileMenuOpen(false); }}
          >
            ⚙️ Preferences
          </button>
          <Link
            href="/admin"
            className="nav-link"
            style={{ display: 'block', padding: '0.625rem 0' }}
            onClick={() => setMobileMenuOpen(false)}
          >
            Admin Panel
          </Link>
        </div>
      )}
    </header>
  );
}
