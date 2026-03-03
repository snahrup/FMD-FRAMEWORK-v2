import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#FDFCFB',
          100: '#FAF9F7',
          200: '#F5F4F0',
          300: '#EDEAE4',
          400: '#E0DBD3',
          500: '#C4BEB4',
        },
        warmgray: {
          300: '#B3ADA3',
          400: '#999488',
          500: '#7A756B',
          600: '#666157',
          700: '#4A4640',
          800: '#2E2B27',
          900: '#1A1917',
        },
        terracotta: {
          50: '#FDF2EE',
          100: '#F9E0D6',
          200: '#F0C4B0',
          300: '#E8A08C',
          400: '#D97757',
          500: '#C75B3A',
          600: '#B5492A',
          700: '#963C22',
          800: '#7A311C',
          900: '#5E2615',
        },
        bronze: {
          400: '#CD7F32',
          500: '#B5712D',
        },
        silver: {
          400: '#A8B5C4',
          500: '#8B99A8',
        },
        gold: {
          400: '#D4AF37',
          500: '#C5A028',
        },
      },
      fontFamily: {
        serif: ['"Tiempos Fine"', 'Georgia', '"Times New Roman"', 'serif'],
        sans: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Berkeley Mono"', '"SF Mono"', 'Menlo', 'monospace'],
      },
      boxShadow: {
        'warm-sm': '0 1px 3px rgba(120, 100, 80, 0.06), 0 1px 2px rgba(120, 100, 80, 0.04)',
        'warm': '0 1px 3px rgba(120, 100, 80, 0.08), 0 4px 12px rgba(120, 100, 80, 0.06)',
        'warm-md': '0 2px 6px rgba(120, 100, 80, 0.1), 0 8px 24px rgba(120, 100, 80, 0.08)',
        'warm-lg': '0 4px 12px rgba(120, 100, 80, 0.12), 0 16px 48px rgba(120, 100, 80, 0.1)',
        'warm-glow': '0 0 20px rgba(201, 91, 58, 0.15), 0 0 60px rgba(201, 91, 58, 0.05)',
      },
      borderRadius: {
        'card': '12px',
        'btn': '8px',
        'pill': '9999px',
      },
      animation: {
        'flow': 'flow 3s ease-in-out infinite',
        'pulse-warm': 'pulse-warm 2s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'particle': 'particle 4s linear infinite',
        'count-up': 'count-up 2s ease-out forwards',
        'fade-up': 'fade-up 0.8s ease-out forwards',
        'slide-in': 'slide-in 0.6s ease-out forwards',
      },
      keyframes: {
        'flow': {
          '0%, 100%': { transform: 'translateX(0)' },
          '50%': { transform: 'translateX(100%)' },
        },
        'pulse-warm': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'particle': {
          '0%': { transform: 'translateX(-10%)', opacity: '0' },
          '10%': { opacity: '1' },
          '90%': { opacity: '1' },
          '100%': { transform: 'translateX(110%)', opacity: '0' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(30px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
