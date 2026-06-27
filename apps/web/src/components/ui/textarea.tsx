import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full resize-none rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-[9px] text-[13px] leading-[1.55] text-[#1a1814] outline-none ring-offset-background placeholder:text-[#6d6a65] focus:border-[#3a5fd9] focus:bg-white disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
