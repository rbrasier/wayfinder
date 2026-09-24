import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex w-full rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] px-3 py-[9px] text-[13px] text-[#1c1b19] outline-none ring-offset-background placeholder:text-[#666055] focus:border-wf-primary focus:bg-white disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";
