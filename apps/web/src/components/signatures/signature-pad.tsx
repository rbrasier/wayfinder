"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/client";

const PAD_WIDTH = 600;
const PAD_HEIGHT = 200;

// Draws and saves the signed-in user's remembered signature (ADR-067 §2). Pointer
// events cover mouse, pen and touch alike. The canvas is transparent, so the
// saved PNG sits cleanly over any document background.
export function SignaturePad({ onSaved }: { onSaved?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const utils = trpc.useUtils();
  const save = trpc.user.saveDrawnSignature.useMutation({
    onSuccess: async () => {
      toast.success("Signature saved");
      await utils.user.getDrawnSignature.invalidate();
      await utils.approval.signingRequirement.invalidate();
      onSaved?.();
    },
    onError: (error) => toast.error(error.message ?? "Could not save your signature"),
  });

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#1e1b4b";
  }, []);

  const pointFrom = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * PAD_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * PAD_HEIGHT,
    };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const point = pointFrom(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const point = pointFrom(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    setHasInk(true);
  };

  const stop = () => {
    drawingRef.current = false;
  };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
    setHasInk(false);
  }, []);

  const submit = () => {
    const dataUrl = canvasRef.current?.toDataURL("image/png");
    if (!dataUrl) return;
    save.mutate({ pngBase64: dataUrl.replace(/^data:image\/png;base64,/, "") });
  };

  return (
    <div className="space-y-2" data-testid="signature-pad">
      <p className="text-sm text-muted-foreground">
        Draw your signature below. It is saved to your profile and placed on documents you approve from now on.
      </p>
      <canvas
        ref={canvasRef}
        width={PAD_WIDTH}
        height={PAD_HEIGHT}
        aria-label="Signature drawing area"
        data-testid="signature-pad-canvas"
        className="w-full touch-none rounded-md border border-dashed border-[#d6d0c4] bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerLeave={stop}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={clear} disabled={!hasInk || save.isPending}>
          Clear
        </Button>
        <Button
          size="sm"
          data-testid="signature-pad-save"
          onClick={submit}
          disabled={!hasInk || save.isPending}
        >
          {save.isPending ? "Saving…" : "Save signature"}
        </Button>
      </div>
    </div>
  );
}
