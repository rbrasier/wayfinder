import * as React from "react";
import { cn } from "@/lib/utils";

// Caption for a group of related controls (a radio set, a swatch row, a list of
// fields) rather than a single input. A native <label> can only name one
// control, so using <Label> here is semantically wrong and fails
// jsx-a11y/label-has-associated-control. Render a <span> instead and associate
// it with the group by giving the controls' container
// role="group" aria-labelledby={id}. Mirrors <Label> styling.
export const FieldGroupLabel = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn(
      "block text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6d6a65]",
      className,
    )}
    {...props}
  />
));
FieldGroupLabel.displayName = "FieldGroupLabel";
