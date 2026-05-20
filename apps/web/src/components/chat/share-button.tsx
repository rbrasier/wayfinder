"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface ShareButtonProps {
  sessionId: string;
}

export function ShareButton({ sessionId }: ShareButtonProps) {
  const handleShare = async () => {
    const url = `${window.location.origin}/chats/${sessionId}?shared=true`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  };

  return (
    <Button variant="outline" size="sm" onClick={handleShare}>
      Share
    </Button>
  );
}
