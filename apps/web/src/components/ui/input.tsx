import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-[9px] text-[13px] text-[#1a1814] outline-none ring-offset-background placeholder:text-[#6d6a65] focus:border-[#3a5fd9] focus:bg-white disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";
