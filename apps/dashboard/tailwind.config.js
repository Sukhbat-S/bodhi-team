/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ["'Iowan Old Style'", "'Source Serif 4'", "Charter", "Georgia", "serif"],
        sans: ["-apple-system", "BlinkMacSystemFont", "'Inter'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "'SF Mono'", "Menlo", "monospace"],
      },
      colors: {
        canvas: "#0E0E10",
        surface: "#17171A",
        "surface-raised": "#1F1F23",
        hairline: "#27272A",
        emphasis: "#3A3A3F",
        primary: "#EDEDEE",
        secondary: "#A6A6AC",
        tertiary: "#87878F",
        disabled: "#64646C",
        "accent-amber": "#D4A76A",
        "accent-amber-soft": "rgba(212, 167, 106, 0.12)",
        panel: "#141416",
        sage: "#7B9B7B",
        warmth: "#C8985A",
        clay: "#B07070",
      },
      transitionTimingFunction: {
        precise: "cubic-bezier(0.32, 0.72, 0, 1)",
        arrival: "cubic-bezier(0.16, 1, 0.3, 1)",
        river: "cubic-bezier(0.5, 0, 0.5, 1)",
      },
      transitionDuration: {
        100: "100ms",
        150: "150ms",
        220: "220ms",
        320: "320ms",
        480: "480ms",
      },
      animation: {
        "morning-arrival": "morning-arrival 480ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
      keyframes: {
        "morning-arrival": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
