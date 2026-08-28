import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */

/**
 * Colours, radii and shadows are lifted from public/portal/assets/css/portal.css
 * so /production/ reads as part of the ETILOG portal rather than a second
 * design system. If a token changes there, change it here too.
 */
export default {
  // Absolute, because the build runs from the repository root and relative
  // globs would resolve against the wrong directory.
  content: [path.join(here, 'index.html'), path.join(here, 'src/**/*.{js,jsx}')],
  theme: {
    extend: {
      colors: {
        etilog: {
          DEFAULT: '#D9000C',
          hover: '#B80009',
          light: 'rgba(217, 0, 12, 0.06)',
          medium: 'rgba(217, 0, 12, 0.12)'
        },
        gray: {
          25: '#fcfcfd',
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827'
        },
        // Card priority accents (section 4.6): urgent red, high orange,
        // blocked amber, normal neutral.
        priority: {
          urgent: '#D9000C',
          high: '#ea580c',
          blocked: '#f59e0b',
          normal: '#94a3b8'
        }
      },
      fontFamily: {
        sans: ['Segoe UI', '-apple-system', 'BlinkMacSystemFont', 'Roboto', 'Helvetica Neue', 'sans-serif']
      },
      borderRadius: {
        DEFAULT: '10px',
        lg: '14px'
      },
      boxShadow: {
        xs: '0 1px 2px rgba(0, 0, 0, 0.04)',
        sm: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
        DEFAULT: '0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -1px rgba(0, 0, 0, 0.04)',
        md: '0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.04)',
        lg: '0 20px 25px -5px rgba(0, 0, 0, 0.08), 0 10px 10px -5px rgba(0, 0, 0, 0.03)',
        card: '0 1px 2px rgba(16, 24, 40, 0.05)',
        cardHover: '0 6px 16px -4px rgba(16, 24, 40, 0.18)',
        // A week block has to read as one object among several stacked down the
        // page, so it sits slightly off the background rather than being drawn
        // on it with a hairline.
        week: '0 1px 2px rgba(16, 24, 40, 0.06), 0 4px 10px -4px rgba(16, 24, 40, 0.10)',
        // The current week lifts further off the page, but in the same neutral
        // ink as every other block. A blue-tinted shadow read as a glow around
        // the whole week and competed with the coloured bars inside it.
        weekCurrent: '0 2px 4px rgba(16, 24, 40, 0.08), 0 12px 28px -10px rgba(16, 24, 40, 0.22)'
      },
      transitionTimingFunction: {
        portal: 'cubic-bezier(0.4, 0, 0.2, 1)'
      }
    }
  },
  plugins: []
};
