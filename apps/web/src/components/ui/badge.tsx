import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
  {
    variants: {
      variant: {
        default:     "bg-[#eef1fc] text-[#3a5fd9]",
        secondary:   "bg-[#efede8] text-[#6d6a65]",
        destructive: "bg-[#fdeef2] text-[#c2385a]",
        outline:     "border border-[#dedad2] text-[#1a1814]",
        blue:        "bg-[#eef1fc] text-[#3a5fd9]",
        green:       "bg-[#eaf6f0] text-[#247c53]",
        amber:       "bg-[#fdf3e3] text-[#9b6215]",
        grey:        "bg-[#efede8] text-[#6d6a65]",
        purple:      "bg-[#f3eeff] text-[#7c3aed]",
        rose:        "bg-[#fdeef2] text-[#c2385a]",
        teal:        "bg-[#e6f7f5] text-[#0d7c6e]",
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
