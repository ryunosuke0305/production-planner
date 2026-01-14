import * as React from "react";

type DialogContextValue = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
};

const DialogContext = React.createContext<DialogContextValue | null>(null);

export function Dialog({ open, onOpenChange, children }: React.PropsWithChildren<DialogContextValue>): JSX.Element {
  return <DialogContext.Provider value={{ open, onOpenChange }}>{children}</DialogContext.Provider>;
}

export function DialogContent({ className = "", children }: React.HTMLAttributes<HTMLDivElement>): JSX.Element | null {
  const ctx = React.useContext(DialogContext);
  if (!ctx?.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 sm:p-8">
      <div className={`w-full max-h-[90vh] overflow-auto rounded-2xl bg-white shadow-xl ${className}`}>
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={`border-b border-slate-100 px-4 py-3 ${className}`} {...props} />;
}

export function DialogTitle({ className = "", ...props }: React.HTMLAttributes<HTMLHeadingElement>): JSX.Element {
  return <h3 className={`text-base font-semibold ${className}`} {...props} />;
}

export function DialogFooter({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={`flex justify-end border-t border-slate-100 px-4 py-3 ${className}`} {...props} />;
}
