import type { Config } from 'tailwindcss';

// Class-based dark mode allows a deliberate switch independent of OS preferences.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        orbit: '#05060D',
        nebula: '#9B7CFF',
        ion: '#52DDF5',
        solar: '#FFCA8A',
        bloom: '#F178D5',
      },
      borderRadius: { glass: '22px' },
      boxShadow: { nebula: '0 0 60px -18px rgba(155,124,255,.46)' },
      animation: {
        'slow-drift': 'slow-drift 18s ease-in-out infinite alternate',
        'twinkle': 'twinkle 5s ease-in-out infinite',
        'shimmer': 'shimmer 1.7s linear infinite',
      },
      keyframes: {
        'slow-drift': { from: { transform: 'translate3d(-2%, -1%, 0)' }, to: { transform: 'translate3d(2%, 2%, 0)' } },
        twinkle: { '0%, 100%': { opacity: '.28' }, '50%': { opacity: '.85' } },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
      },
    },
  },
  plugins: [],
} satisfies Config;
