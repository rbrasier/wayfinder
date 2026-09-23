import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
  {
    variants: {
      variant: {
        default:     "bg-wf-primary-light text-wf-primary",
        secondary:   "bg-[#f5f3ee] text-[#666055]",
        destructive: "bg-[#f9e8eb] text-[#a8324c]",
        outline:     "border border-[#e7e3db] text-[#1c1b19]",
        blue:        "bg-wf-primary-light text-wf-primary",
        green:       "bg-[#e3efe5] text-[#1f6b4d]",
        amber:       "bg-[#f6e9d8] text-[#8a5a1d]",
        grey:        "bg-[#f5f3ee] text-[#666055]",
        purple:      "bg-[#efeafa] text-[#5b3fa8]",
        rose:        "bg-[#f9e8eb] text-[#a8324c]",
        teal:        "bg-[#e6f2ee] text-[#14312e]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <div className={cn(badgeVariants({ variant }), className)} {...props} />
);
