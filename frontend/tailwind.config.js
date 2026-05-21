/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "on-surface": "#e5e2e1",
        "primary": "#ecb2ff",
        "surface": "#131313",
        "on-background": "#e5e2e1",
        "secondary": "#92ccff",
        "surface-container": "#201f1f",
        "surface-container-high": "#2a2a2a",
        "outline-variant": "#4e4350",
        "on-primary": "#520071",
        "tertiary": "#efc209"
      },
      fontFamily: {
        "headline": ["Space Grotesk"],
        "body": ["Manrope"]
      }
    }
  },
  plugins: [],
}
