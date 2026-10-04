import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { iniciarActualizacionPwa } from './pwa-update.ts'
import { aplicarTemaMarcaGuardado } from './lib/tema-marca.ts'

// Pinta la marca recordada antes del primer render (evita parpadeo de color).
aplicarTemaMarcaGuardado()
iniciarActualizacionPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
