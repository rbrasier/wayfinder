"use client";

import { EmptyState } from "@/components/empty-state";
import { EditorCards } from "@/components/extraction/editor-cards";
import { trpc } from "@/trpc/client";

export function EditSynthesisContent({ flowId }: { flowId: string }) {
  const schemaQuery = trpc.extraction.getSchema.useQuery({ flowId });

  if (schemaQuery.error) {
    return (
      <div className="mx-auto max-w-[900px] px-5 py-7">
        <EmptyState heading="Cannot open this synthesis" body={schemaQuery.error.message} />
      </div>
    );
  }

  return (
    <EditorCards
      flowId={flowId}
      initialSchema={schemaQuery.data ?? null}
      isLoading={schemaQuery.isLoading}
    />
  );
}
