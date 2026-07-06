"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/trpc/client";

type HrFieldKind = "email" | "name" | "manager" | "position" | "band" | "unit";

const HR_FIELD_OPTIONS: { value: HrFieldKind | ""; label: string }[] = [
  { value: "", label: "— Not mapped —" },
  { value: "email", label: "Email" },
  { value: "name", label: "Display name" },
  { value: "manager", label: "Manager (email)" },
  { value: "position", label: "Position / role" },
  { value: "band", label: "Band / grade" },
  { value: "unit", label: "Business unit" },
];

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export function HrDataCard() {
  const utils = trpc.useUtils();
  const datasetsQuery = trpc.hr.list.useQuery();
  const datasets = datasetsQuery.data ?? [];
  const [isUploading, setIsUploading] = useState(false);
  const [mappingFor, setMappingFor] = useState<string | null>(null);
  const [draftMapping, setDraftMapping] = useState<Record<string, HrFieldKind | "">>({});

  const uploadMutation = trpc.hr.upload.useMutation({
    onSuccess: async () => {
      toast.success("HR dataset uploaded");
      await utils.hr.list.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Upload failed"),
  });
  const mappingMutation = trpc.hr.setMapping.useMutation({
    onSuccess: async () => {
      toast.success("Column mapping saved");
      await utils.hr.list.invalidate();
      setMappingFor(null);
    },
    onError: (error) => toast.error(error.message ?? "Could not save mapping"),
  });

  const handleFile = async (file: File | null) => {
    if (!file) return;
    const format = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv";
    setIsUploading(true);
    try {
      const contentBase64 = await fileToBase64(file);
      await uploadMutation.mutateAsync({ filename: file.name, format, contentBase64 });
    } finally {
      setIsUploading(false);
    }
  };

  const openMapping = (datasetId: string, columns: string[], current: Record<string, string>) => {
    const draft: Record<string, HrFieldKind | ""> = {};
    for (const column of columns) {
      draft[column] = (current[column] as HrFieldKind | undefined) ?? "";
    }
    setDraftMapping(draft);
    setMappingFor(datasetId);
  };

  const saveMapping = () => {
    if (!mappingFor) return;
    const mapping: Record<string, HrFieldKind> = {};
    for (const [header, kind] of Object.entries(draftMapping)) {
      if (kind) mapping[header] = kind;
    }
    mappingMutation.mutate({ datasetId: mappingFor, mapping });
  };

  const editing = datasets.find((dataset) => dataset.id === mappingFor);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">HR Directory Data</CardTitle>
        <label className="cursor-pointer">
          <input
            type="file"
            accept=".csv,.xlsx"
            className="sr-only"
            onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
          />
          <span className="inline-flex h-8 items-center rounded-md border px-3 text-sm">
            {isUploading ? "Uploading…" : "Upload CSV/XLSX"}
          </span>
        </label>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-xs text-muted-foreground">
          Stored as uploaded and searchable immediately. Map columns so first/second-level
          resolution and the dynamic position lookup can read manager, position, band and unit.
        </p>
        {datasets.length === 0 ? (
          <p className="text-muted-foreground">No HR dataset uploaded yet.</p>
        ) : (
          datasets.map((dataset) => (
            <div
              key={dataset.id}
              className="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{dataset.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {dataset.rowCount} rows · {dataset.columns.length} columns ·{" "}
                  {Object.keys(dataset.columnMapping).length > 0 ? "mapped" : "not mapped"}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openMapping(dataset.id, dataset.columns, dataset.columnMapping)}
              >
                Map columns
              </Button>
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={Boolean(mappingFor)} onOpenChange={(open) => !open && setMappingFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Map columns</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="max-h-[60vh] space-y-3 overflow-y-auto">
            {editing?.columns.map((column) => (
              <div key={column} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm">{column}</span>
                <select
                  aria-label={`Mapping for ${column}`}
                  className="h-9 rounded-md border px-2 text-sm"
                  value={draftMapping[column] ?? ""}
                  onChange={(event) =>
                    setDraftMapping((prev) => ({
                      ...prev,
                      [column]: event.target.value as HrFieldKind | "",
                    }))
                  }
                >
                  {HR_FIELD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMappingFor(null)}>
              Cancel
            </Button>
            <Button onClick={saveMapping} disabled={mappingMutation.isPending}>
              Save mapping
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
