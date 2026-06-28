import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-24 text-center">
      <h1
        className="text-7xl font-extrabold mb-4"
        style={{
          background: 'var(--gradient-primary)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        404
      </h1>
      <p className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        Page not found
      </p>
      <p className="mb-8" style={{ color: 'var(--text-muted)' }}>
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link href="/" className="btn-primary">
        ← Back to Home
      </Link>
    </div>
  );
}
