'use client';

import Link from 'next/link';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  basePath?: string;
  category?: string;
}

export default function Pagination({ currentPage, totalPages, basePath = '/', category }: PaginationProps) {
  if (totalPages <= 1) return null;

  const getHref = (page: number) => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    if (category) params.set('category', category);
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="flex items-center justify-center gap-2 mt-8">
      {currentPage > 1 && (
        <Link
          href={getHref(currentPage - 1)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          ← Previous
        </Link>
      )}

      <span className="text-sm text-gray-500">
        Page {currentPage} of {totalPages}
      </span>

      {currentPage < totalPages && (
        <Link
          href={getHref(currentPage + 1)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          Next →
        </Link>
      )}
    </div>
  );
}
