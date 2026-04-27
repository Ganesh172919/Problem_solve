import Link from 'next/link';

export default function Pagination({
  currentPage,
  totalPages,
}: {
  currentPage: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  const pages: (number | '...')[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }

  return (
    <nav className="flex items-center justify-center gap-2 mt-10">
      {currentPage > 1 && (
        <Link
          href={`?page=${currentPage - 1}`}
          className="btn-ghost"
          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Prev
        </Link>
      )}

      {pages.map((p, idx) =>
        p === '...' ? (
          <span key={`ellipsis-${idx}`} style={{ color: 'var(--text-muted)', padding: '0 4px' }}>
            …
          </span>
        ) : (
          <Link
            key={p}
            href={`?page=${p}`}
            className={p === currentPage ? 'btn-primary' : 'btn-ghost'}
            style={{
              padding: '6px 12px',
              fontSize: '0.8rem',
              minWidth: '36px',
              textAlign: 'center',
              justifyContent: 'center',
            }}
          >
            {p}
          </Link>
        ),
      )}

      {currentPage < totalPages && (
        <Link
          href={`?page=${currentPage + 1}`}
          className="btn-ghost"
          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
        >
          Next
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      )}
    </nav>
  );
}
