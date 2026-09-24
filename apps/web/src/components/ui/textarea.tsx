import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full resize-none rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] px-3 py-[9px] text-[13px] leading-[1.55] text-[#1c1b19] outline-none ring-offset-background placeholder:text-[#666055] focus:border-wf-primary focus:bg-white disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
