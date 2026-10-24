"use client";

import { WatchEditor } from "@/components/event-watch/watch-editor";
import { CardSkeleton } from "@/components/skeleton/card-skeleton";
import { trpc } from "@/trpc/client";

export function EditEventWatchContent({ watchId }: { watchId: string }) {
  const watchQuery = trpc.eventWatch.get.useQuery({ id: watchId });
  if (watchQuery.error) {
    return <p className="container py-8 text-sm text-destructive">{watchQuery.error.message}</p>;
  }
  if (!watchQuery.data) {
    return (
      <div className="container py-8">
        <CardSkeleton />
      </div>
    );
  }
  return <WatchEditor key={watchQuery.data.watch.updatedAt.toString()} existing={watchQuery.data} />;
}
