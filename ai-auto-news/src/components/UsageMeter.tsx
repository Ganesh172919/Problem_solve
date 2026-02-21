interface UsageMeterProps {
  label: string;
  used: number;
  limit: number;
  unit?: string;
}

function getColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-yellow-500';
  return 'bg-green-500';
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function UsageMeter({ label, used, limit, unit = '' }: UsageMeterProps) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color = getColor(pct);
  const isUnlimited = limit >= 1_000_000;

  return (
    <div className="w-full">
      <div className="flex justify-between text-sm text-gray-600 mb-1">
        <span className="font-medium">{label}</span>
        <span>
          {isUnlimited ? (
            <span className="text-green-600 font-medium">Unlimited</span>
          ) : (
            <>
              {formatNumber(used)}{unit} / {formatNumber(limit)}{unit}
              <span className="ml-2 text-gray-400">({pct}%)</span>
            </>
          )}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
        {!isUnlimited && (
          <div
            className={`h-full rounded-full transition-all duration-300 ${color}`}
            style={{ width: `${pct}%` }}
          />
        )}
        {isUnlimited && <div className="h-full w-full rounded-full bg-green-500" />}
      </div>
    </div>
  );
}
