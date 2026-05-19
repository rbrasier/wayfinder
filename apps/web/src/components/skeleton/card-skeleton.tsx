export function CardSkeleton() {
  return <div className="h-24 animate-pulse rounded-xl bg-muted" />;
}

export function CardSkeletonGrid({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

export function TableRowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-md p-3">
      <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
      <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
      <div className="h-4 w-1/6 animate-pulse rounded bg-muted" />
    </div>
  );
}

export function TableSkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2 py-2">
      {Array.from({ length: count }).map((_, i) => (
        <TableRowSkeleton key={i} />
      ))}
    </div>
  );
}
