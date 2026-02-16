import * as React from "react";
import { Input } from "@/components/ui/input";

export type SearchableOption = {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
};

type SearchableComboboxProps = {
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
};

export function SearchableCombobox({
  value,
  options,
  onChange,
  placeholder,
  emptyLabel = "該当する候補がありません",
  disabled = false,
}: SearchableComboboxProps): JSX.Element {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const selected = React.useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);

  React.useEffect(() => {
    if (selected) {
      setQuery(selected.label);
      return;
    }
    if (!open) {
      setQuery("");
    }
  }, [open, selected]);

  const filteredOptions = React.useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) => {
      const haystack = `${option.label} ${option.description ?? ""} ${option.keywords ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [options, query]);

  const handleSelect = (option: SearchableOption) => {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
  };

  const handleClear = () => {
    onChange("");
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <Input
        className="pr-10"
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => {
          if (!disabled) setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (filteredOptions[0]) {
              handleSelect(filteredOptions[0]);
            }
          }
          if (event.key === "Escape") {
            setOpen(false);
            setQuery(selected?.label ?? "");
          }
        }}
        onBlur={() => {
          window.setTimeout(() => {
            setOpen(false);
            setQuery(selected?.label ?? "");
          }, 120);
        }}
      />
      {!disabled && query ? (
        <button
          type="button"
          className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          onMouseDown={(event) => {
            event.preventDefault();
            handleClear();
          }}
          aria-label="品目入力をクリア"
        >
          ×
        </button>
      ) : null}
      {open ? (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-white shadow">
          {filteredOptions.length ? (
            filteredOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleSelect(option);
                }}
              >
                <span>{option.label}</span>
                {option.description ? (
                  <span className="text-xs text-muted-foreground">{option.description}</span>
                ) : null}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground">{emptyLabel}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
