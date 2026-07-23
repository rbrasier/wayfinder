"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RunHistory } from "@/components/extraction/run-history";
import { trpc } from "@/trpc/client";

const readAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export function RunsContent({ flowId }: { flowId: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);

  const startMutation = trpc.extraction.startBatch.useMutation({
    onSuccess: (data) => {
      toast.success(`Started a run over ${data.totalCount} document(s)`);
      router.push(`/synthesise/${flowId}/runs/${data.runId}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const start = async () => {
    const payload = await Promise.all(
      files.map(async (file) => ({
        filename: file.name,
        treePath: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64: await readAsBase64(file),
      })),
    );
    startMutation.mutate({ flowId, files: payload, archives: [] });
  };

  return (
    <div className="mx-auto max-w-[1100px] px-[20px] py-[28px]">
      <div className="mb-[20px] flex items-center justify-between">
        <div>
          <Link href="/synthesise" className="text-[12px] text-[#3a5fd9] hover:underline">
            ← Back to Synthesise Information
          </Link>
          <h1 className="mt-[4px] text-[20px] font-bold text-[#1a1814]">Runs</h1>
        </div>
        <Link href={`/synthesise/${flowId}/edit`} className="text-[12px] text-[#3a5fd9] hover:underline">
          Edit synthesis
        </Link>
      </div>

      <div className="mb-[24px] flex flex-wrap items-center gap-[10px] rounded-[10px] border border-[#e5e1d8] bg-white p-[16px]">
        <input
          type="file"
          multiple
          aria-label="Documents to process"
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          className="text-[13px]"
        />
        <Button
          type="button"
          disabled={files.length === 0 || startMutation.isPending}
          onClick={() => void start()}
        >
          {startMutation.isPending ? "Starting…" : "Start run"}
        </Button>
        <span className="text-[12px] text-[#8a857c]">
          Requires a published synthesis. Preview turns on by default above 5 files.
        </span>
      </div>

      <RunHistory flowId={flowId} />
    </div>
  );
}
