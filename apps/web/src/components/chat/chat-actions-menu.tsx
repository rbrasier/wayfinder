"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ChatActionsMenuProps {
  sessionTitle: string | null;
  shareUrl: string;
  collaborateUrl: string;
  onRename: (title: string) => void;
  onClose: () => void;
  isReadOnly?: boolean;
}

export function ChatActionsMenu({
  sessionTitle,
  shareUrl,
  collaborateUrl,
  onRename,
  onClose,
  isReadOnly = false,
}: ChatActionsMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(sessionTitle ?? "");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const handleShare = async () => {
    await navigator.clipboard.writeText(shareUrl);
    toast.success("Link copied — share with a colleague to start a new chat session using this flow");
    setMenuOpen(false);
  };

  const handleCollaborate = async () => {
    await navigator.clipboard.writeText(collaborateUrl);
    toast.success("Link copied, share it with a colleague to collaborate in this chat session");
    setMenuOpen(false);
  };

  const handleRenameOpen = () => {
    setRenameValue(sessionTitle ?? "");
    setMenuOpen(false);
    setRenameOpen(true);
  };

  const handleRenameSave = () => {
    if (!renameValue.trim()) return;
    onRename(renameValue.trim());
    setRenameOpen(false);
  };

  const handleClose = () => {
    setMenuOpen(false);
    onClose();
  };

  return (
    <>
      <div className="relative" ref={menuRef}>
        <Button
          variant="outline"
          size="sm"
          aria-label="Chat actions"
          onClick={() => setMenuOpen((prev) => !prev)}
          className="px-2"
        >
          <MoreHorizontal size={16} />
        </Button>

        {menuOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-[9px] border border-[#dedad2] bg-white py-1 shadow-md">
            {!isReadOnly && (
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                onClick={handleRenameOpen}
              >
                Rename
              </button>
            )}
            {!isReadOnly && (
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                onClick={handleClose}
              >
                Close
              </button>
            )}
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
              onClick={handleShare}
            >
              Share
            </button>
            {!isReadOnly && (
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                onClick={handleCollaborate}
              >
                Collaborate
              </button>
            )}
          </div>
        )}
      </div>

      <Dialog open={renameOpen} onOpenChange={(open) => !open && setRenameOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <div className="space-y-1">
              <Label htmlFor="rename-input">Name</Label>
              <Input
                id="rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRenameSave()}
                autoFocus
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRenameSave} disabled={!renameValue.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
