import * as React from "react";

type BadgeVariant = "default" | "secondary";

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-slate-900 text-white",
  secondary: "bg-slate-200 text-slate-900",
};

export function Badge({ variant = "default", className = "", ...props }: BadgeProps): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        variantStyles[variant]
      } ${className}`}
      {...props}
    />
  );
}
