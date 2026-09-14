import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ThemeProvider } from './lib/theme.tsx'
import { RouterProvider } from './lib/router.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider>
        <App />
      </RouterProvider>
    </ThemeProvider>
  </StrictMode>,
)
