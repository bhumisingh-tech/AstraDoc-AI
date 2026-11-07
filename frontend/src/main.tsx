import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

// React mounts the app; FastAPI serves this bundle after Vite builds it.
const node = document.getElementById('root');
if (!node) throw new Error('Root element was not found.');
ReactDOM.createRoot(node).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
