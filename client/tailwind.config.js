/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#21295C",
        slate: "#5B6480",
        border: "#D9DCE3",
        teal: "#1C7293",
        "teal-dark": "#065A82",
        red: "#B23A2E",
        "red-pale": "#FBF3F2",
        bg: "#F2F2F2",
        "bg-alt": "#EDEFF3",
        ink: "#16181F",
      },
      fontFamily: {
        serif: ["'Source Serif 4'", "Cambria", "Georgia", "serif"],
        sans: ["'Source Sans 3'", "Calibri", "'Segoe UI'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};
