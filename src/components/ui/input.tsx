import * as React from "react";
import { formControlBase } from "@/components/ui/form-control";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className = "", ...props }: InputProps): JSX.Element {
  return (
    <input
      className={`${formControlBase} ${className}`}
      {...props}
    />
  );
}
