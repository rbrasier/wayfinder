"use client";

import { useState } from "react";
import type { ExtractionSchemaDraft } from "@wayfinder/domain";
import { trpc } from "@/trpc/client";

// The "view system prompt" dialog's state, kept out of the editor so the editor
// stays under the source-size ratchet. Builds from the editor's current,
// possibly unsaved schema, so the author previews what they are looking at.
export function useSystemPromptPreview(flowId: string, buildSchemaInput: () => ExtractionSchemaDraft) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const view = async (): Promise<void> => {
    setOpen(true);
    setError(null);
    setSystemPrompt(null);
    setLoading(true);
    try {
      const result = await utils.extraction.previewSystemPrompt.fetch({ flowId, schema: buildSchemaInput() });
      setSystemPrompt(result.systemPrompt);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Could not build the system prompt.");
    } finally {
      setLoading(false);
    }
  };

  return { open, setOpen, systemPrompt, error, loading, view };
}
