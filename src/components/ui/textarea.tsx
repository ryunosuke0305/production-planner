import * as React from "react";
import { formControlBase } from "@/components/ui/form-control";

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className = "", ...props }: TextareaProps): JSX.Element {
  return (
    <textarea
      className={`${formControlBase} ${className}`}
      {...props}
    />
  );
}
