import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './Homepage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
