import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { initializeGlobalBrowserListeners } from './lib/selfHealingGuard.ts';
import './index.css';

// Initialize global window error telemetry
initializeGlobalBrowserListeners();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

