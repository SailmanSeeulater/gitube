import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App'
import { useGardenStore } from './store/useGardenStore'
import { applyTheme } from './theme/applyTheme'
import { getTheme } from './theme/themes'

// The saved theme goes on <html> before React's first (asynchronous) render, so nothing paints in
// another theme first. (theme-boot, injected into index.html by vite.config.ts, did this already
// before the stylesheet painted; this covers a page without it.) App keeps it in sync afterwards.
applyTheme(getTheme(useGardenStore.getState().themeId))

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
