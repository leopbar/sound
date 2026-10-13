/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: '#1ed760', dim: '#1db954' },
        surface: { 900: '#0b0b0f', 800: '#121218', 700: '#1a1a22', 600: '#26262f' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
