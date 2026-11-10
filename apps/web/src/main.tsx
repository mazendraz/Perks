import './compat.js';
import './validation.js';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';
import './features.css';
import './design.css';
import './mobile.css';
if (!window.__nuqtaUnsupported)
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
