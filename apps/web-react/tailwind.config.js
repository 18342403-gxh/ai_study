/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#6366f1',
        'primary-light': '#818cf8',
        accent: '#06b6d4',
      },
    },
  },
  plugins: [],
}
