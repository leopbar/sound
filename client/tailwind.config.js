/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: '#1ea7ff', dim: '#0b8fe6' },
        surface: { 900: '#0b0b0f', 800: '#121218', 700: '#1a1a22', 600: '#26262f' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
