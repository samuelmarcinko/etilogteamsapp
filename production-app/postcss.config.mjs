import { fileURLToPath } from 'url';
import path from 'path';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const here = path.dirname(fileURLToPath(import.meta.url));

// Point Tailwind at this directory's config explicitly. The build runs from the
// repository root (`npm run build:production`), where there is no tailwind
// config, so without this it silently falls back to defaults and every custom
// class fails to resolve.
export default {
  plugins: [tailwindcss({ config: path.join(here, 'tailwind.config.js') }), autoprefixer()]
};
