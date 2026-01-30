import type { InfoTooltipProps } from "@/types/planning";

export const InfoTooltip = ({ text }: InfoTooltipProps) => (
  <span className="group relative inline-flex h-4 w-4 items-center justify-center text-slate-500">
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM9 9.5a.75.75 0 011.5 0v5a.75.75 0 01-1.5 0v-5z"
        clipRule="evenodd"
      />
    </svg>
    <span className="pointer-events-none absolute left-1/2 top-6 z-10 w-56 -translate-x-1/2 rounded bg-slate-900 px-2 py-1 text-[11px] text-white opacity-0 shadow transition-opacity group-hover:opacity-100 whitespace-pre-line">
      {text}
    </span>
  </span>
);
