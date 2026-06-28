'use client';

import { useState, useEffect } from 'react';

interface ConfigStatus {
  configured: boolean;
  message: string;
}

/**
 * ConfigBanner — shows a warning when GEMINI_API_KEY is not set.
 * Fetched from /api/health so it works server-side.
 * Only shown to admin users (checks for admin cookie).
 */
export default function ConfigBanner() {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && !data.geminiConfigured) {
          setStatus({
            configured: false,
            message: 'GEMINI_API_KEY is not set. Content generation is disabled.',
          });
        }
      })
      .catch(() => {});
  }, []);

  if (!status || dismissed) return null;

  return (
    <div
      style={{
        background: 'rgba(220, 38, 38, 0.08)',
        borderBottom: '1px solid rgba(220, 38, 38, 0.2)',
        padding: '0.75rem 1rem',
        fontSize: '0.85rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
      }}
    >
      <span style={{ color: '#DC2626', fontWeight: 600 }}>⚠️</span>
      <span style={{ color: '#991B1B' }}>
        {status.message}{' '}
        <a
          href="https://aistudio.google.com/app/apikey"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#DC2626', fontWeight: 600, textDecoration: 'underline' }}
        >
          Get a free key →
        </a>
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={{
          background: 'none',
          border: 'none',
          color: '#991B1B',
          cursor: 'pointer',
          fontSize: '1.1rem',
          padding: '0 0.25rem',
          lineHeight: 1,
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
