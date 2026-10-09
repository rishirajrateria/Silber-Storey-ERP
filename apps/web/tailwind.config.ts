import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: { accent: 'rgb(var(--accent) / <alpha-value>)', ink: '#13203a', mute: '#6b7591' },
      borderRadius: { xl2: '1.25rem' },
      boxShadow: { glass: '0 8px 32px rgba(31,58,95,.08), inset 0 1px 0 rgba(255,255,255,.6)', soft: '0 2px 12px rgba(31,58,95,.06)' },
    },
  },
  plugins: [],
} satisfies Config;
