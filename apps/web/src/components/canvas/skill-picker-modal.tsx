"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/client";

interface SkillPickerModalProps {
  open: boolean;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}

// A focused picker for attaching library skills to a step, opened from the
// compact button beside the AI instructions. Keeps the node config modal clean by
// moving the full skill list out of the always-visible form.
export function SkillPickerModal({ open, selectedIds, onChange, onClose }: SkillPickerModalProps) {
  const skillsQuery = trpc.skill.list.useQuery(undefined, { enabled: open });
  const skills = skillsQuery.data ?? [];
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? skills.filter((skill) =>
        `${skill.name} ${skill.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : skills;

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((existing) => existing !== id)
        : [...selectedIds, id],
    );
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add skills</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="text-[12px] text-[#857f76]">
            Attach reusable skills to steer the AI. Upload skills on the Skills page.
          </p>
          {skills.length > 0 && (
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#918d87]"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search skills…"
                className="pl-8"
              />
            </div>
          )}
          {skills.length === 0 ? (
            <p className="text-[13px] text-[#857f76]">No skills available yet.</p>
          ) : filtered.length === 0 ? (
            <p className="text-[13px] text-[#857f76]">No skills match “{query}”.</p>
          ) : (
            <div className="max-h-[46vh] space-y-1.5 overflow-y-auto rounded-[9px] border border-[#dedad2] p-2.5">
              {filtered.map((skill) => (
                <label key={skill.id} className="flex cursor-pointer items-start gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selectedIds.includes(skill.id)}
                    onChange={() => toggle(skill.id)}
                  />
                  <span>
                    <span className="font-medium">{skill.name}</span>
                    {skill.description ? (
                      <span className="text-[#857f76]"> — {skill.description}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
