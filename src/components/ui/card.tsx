import * as React from "react";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

type HeadingProps = React.HTMLAttributes<HTMLHeadingElement>;

export function Card({ className = "", ...props }: DivProps): JSX.Element {
  return <div className={`rounded-xl border border-slate-200 bg-white ${className}`} {...props} />;
}

export function CardHeader({ className = "", ...props }: DivProps): JSX.Element {
  return <div className={`border-b border-slate-100 px-4 py-3 ${className}`} {...props} />;
}

export function CardTitle({ className = "", ...props }: HeadingProps): JSX.Element {
  return <h3 className={`text-lg font-semibold ${className}`} {...props} />;
}

export function CardContent({ className = "", ...props }: DivProps): JSX.Element {
  return <div className={`px-4 py-3 ${className}`} {...props} />;
}
