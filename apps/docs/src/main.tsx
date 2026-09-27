import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './design/tokens.css';
import './design/base.css';
import './styles/site.css';
import './styles/docs.css';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './app.js';
import { normalizePath } from './router.js';
import { loadPage } from './page-registry.js';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');

// Prerendered pages hydrate after loading the same data the server rendered with.
await loadPage(normalizePath(location.pathname)).catch(() => undefined);
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);
if (root.firstElementChild) hydrateRoot(root, app);
else createRoot(root).render(app);
