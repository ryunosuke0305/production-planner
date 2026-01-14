import * as React from "react";

type ButtonVariant = "default" | "outline" | "destructive" | "secondary";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const baseStyles =
  "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60";

const variantStyles: Record<ButtonVariant, string> = {
  default: "bg-slate-900 text-white hover:bg-slate-800",
  outline: "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
  destructive: "bg-red-600 text-white hover:bg-red-500",
  secondary: "bg-slate-200 text-slate-900 hover:bg-slate-300",
};

export function Button({ variant = "default", className = "", ...props }: ButtonProps): JSX.Element {
  return <button className={`${baseStyles} ${variantStyles[variant]} ${className}`} {...props} />;
}
