'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  const links = [
    { href: '/', label: 'Home' },
    { href: '/category/ai', label: 'AI' },
    { href: '/category/tech', label: 'Tech' },
    { href: '/category/business', label: 'Business' },
    { href: '/search', label: 'Search', icon: true },
    { href: '/about', label: 'About' },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <header
      className="sticky top-0 z-50"
      style={{
        background: 'rgba(10, 10, 26, 0.86)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      }}
    >
      <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="brand-mark" aria-hidden="true">AI</span>
            <span className="text-xl font-bold gradient-text-animate">AI Auto News</span>
          </Link>

          <div className="hidden md:flex md:items-center md:space-x-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                style={{
                  color: isActive(link.href) ? '#a78bfa' : '#94a3b8',
                  background: isActive(link.href) ? 'rgba(139, 92, 246, 0.1)' : 'transparent',
                }}
              >
                {link.icon && (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

            <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.1)', margin: '0 8px' }} />

            <Link href="/admin" className="btn-primary" style={{ padding: '6px 16px', fontSize: '0.8rem' }}>
              Admin
            </Link>
          </div>

          <button
            type="button"
            className="md:hidden rounded-lg p-2 transition-colors"
            style={{ color: '#94a3b8' }}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              )}
            </svg>
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden pb-4 animate-slide-down" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="pt-2 space-y-1">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    color: isActive(link.href) ? '#a78bfa' : '#94a3b8',
                    background: isActive(link.href) ? 'rgba(139, 92, 246, 0.1)' : 'transparent',
                  }}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/admin"
                className="block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{ color: '#94a3b8' }}
                onClick={() => setMobileMenuOpen(false)}
              >
                Admin Panel
              </Link>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
