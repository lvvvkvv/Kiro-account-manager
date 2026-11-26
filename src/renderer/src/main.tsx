import './styles/globals.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { UpdateProvider } from './contexts/UpdateContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UpdateProvider><App /></UpdateProvider>
  </StrictMode>
)
