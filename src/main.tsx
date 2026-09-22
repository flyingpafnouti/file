import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import '../app/globals.css';

createRoot(document.getElementById('root')!).render(<StrictMode><Home /></StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`));
