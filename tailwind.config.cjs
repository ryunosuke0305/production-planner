/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"] ,
  theme: {
    extend: {
      colors: {
        background: "#f8fafc",
        foreground: "#0f172a",
        muted: "#f1f5f9",
        "muted-foreground": "#64748b",
        border: "#e2e8f0",
        ring: "#38bdf8",
        primary: "#0f172a",
        "primary-foreground": "#f8fafc",
        destructive: "#ef4444",
        "destructive-foreground": "#f8fafc",
      },
    },
  },
  plugins: [],
};
