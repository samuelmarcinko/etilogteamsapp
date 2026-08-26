import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

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
      {/* Bottom-centre so the Undo action is near the thumb on a tablet and
          never covers the week header. */}
      <Toaster
        position="bottom-center"
        toastOptions={{
          className: 'text-[13px]',
          actionButtonStyle: { background: '#D9000C', color: '#fff', fontWeight: 600 }
        }}
      />
    </QueryClientProvider>
  </React.StrictMode>
);
