/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        ibm: ['"IBM VGA 9x16"', '"Courier New"', "Courier", "monospace"],
      },
      dropShadow: {
        purr: "6px 6px rgba(0, 0, 0, 0.4)",
      },
    },
  },
  plugins: [],
}
