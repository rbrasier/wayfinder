"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { EditorCards } from "@/components/extraction/editor-cards";
import { trpc } from "@/trpc/client";

export function EditSynthesisContent({ flowId }: { flowId: string }) {
  const schemaQuery = trpc.extraction.getSchema.useQuery({ flowId });

  const publishMutation = trpc.extraction.publish.useMutation({
    onSuccess: (data) => toast.success(`Published version ${data.versionNumber ?? ""}`.trim()),
    onError: (error) => toast.error(error.message),
  });

  if (schemaQuery.error) {
    return (
      <div className="mx-auto max-w-[1100px] px-[20px] py-[28px]">
        <EmptyState
          heading="Cannot open this synthesis"
          body={schemaQuery.error.message}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-[20px] py-[28px]">
      <div className="mb-[20px] flex items-center justify-between">
        <div>
          <Link href="/synthesise" className="text-[12px] text-[#3a5fd9] hover:underline">
            ← Back to Synthesise Information
          </Link>
          <h1 className="mt-[4px] text-[20px] font-bold text-[#1a1814]">Edit synthesis</h1>
        </div>
        <div className="flex items-center gap-[8px]">
          <Button asChild variant="outline">
            <Link href={`/synthesise/${flowId}/runs`}>Runs</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={publishMutation.isPending}
            onClick={() => publishMutation.mutate({ flowId })}
          >
            Publish
          </Button>
        </div>
      </div>

      {schemaQuery.isLoading ? (
        <p className="text-[13px] text-[#8a857c]">Loading…</p>
      ) : (
        <EditorCards flowId={flowId} initialSchema={schemaQuery.data ?? null} />
      )}
    </div>
  );
}
