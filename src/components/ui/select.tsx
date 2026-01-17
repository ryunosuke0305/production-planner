import * as React from "react";
import { formControlBase } from "@/components/ui/form-control";

type SelectProps = {
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
};

type SelectItemProps = {
  value: string;
  children: React.ReactNode;
};

type SelectValueProps = {
  placeholder?: string;
};

function collectItems(nodes: React.ReactNode): SelectItemProps[] {
  const items: SelectItemProps[] = [];

  const walk = (childNodes: React.ReactNode) => {
    React.Children.forEach(childNodes, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === SelectItem) {
        items.push({ value: String(child.props.value), children: child.props.children });
      }
      if (child.props?.children) {
        walk(child.props.children);
      }
    });
  };

  walk(nodes);
  return items;
}

function collectPlaceholder(nodes: React.ReactNode): string | undefined {
  let placeholder: string | undefined;

  const walk = (childNodes: React.ReactNode) => {
    React.Children.forEach(childNodes, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === SelectValue && typeof child.props.placeholder === "string") {
        placeholder = child.props.placeholder;
      }
      if (child.props?.children) {
        walk(child.props.children);
      }
    });
  };

  walk(nodes);
  return placeholder;
}

export function Select({ value, onValueChange, children, className = "" }: SelectProps): JSX.Element {
  const items = collectItems(children);
  const placeholder = collectPlaceholder(children);

  return (
    <div className={className}>
      <select
        className={formControlBase}
        value={value ?? ""}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.children}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SelectTrigger({ children }: { children?: React.ReactNode }): JSX.Element {
  return <>{children}</>;
}

export function SelectValue({ placeholder }: SelectValueProps): JSX.Element | null {
  return placeholder ? <span className="sr-only">{placeholder}</span> : null;
}

export function SelectContent({ children }: { children?: React.ReactNode }): JSX.Element {
  return <>{children}</>;
}

export function SelectItem({ children }: SelectItemProps): JSX.Element {
  return <>{children}</>;
}
