/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#09090b", // Zinco 950
        surface: "#18181b",    // Zinco 900
        primary: "#3b82f6",    // Azul
        secondary: "#27272a",  // Zinco 800
        accent: "#f472b6",     // Rosa
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      }
    },
  },
  plugins: [],
}