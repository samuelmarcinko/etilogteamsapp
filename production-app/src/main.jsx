import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A plan changes when a planner publishes, not second to second. Refetch
      // on focus so a shop-floor tablet left open picks changes up.
      staleTime: 30 * 1000,
      refetchOnWindowFocus: true,
      // The API client already sends the user to the portal login on 401;
      // retrying that would only delay the redirect.
      retry: (failureCount, error) => error?.status !== 401 && failureCount < 2
    }
  }
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
