import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { iniciarActualizacionPwa } from './pwa-update.ts'
import { iniciarVersionRemota } from './lib/offline/actualizador-servicio.ts'
import { aplicarTemaMarcaGuardado } from './lib/tema-marca.ts'
import { registrarTiposF4 } from './lib/offline/f4/servicio-f4.ts'

// Pinta la marca recordada antes del primer render (evita parpadeo de color).
aplicarTemaMarcaGuardado()
iniciarActualizacionPwa()
iniciarVersionRemota()
// Tipos de operación de la cola (toma física, altas, transformaciones, packing list): antes de que se envíe nada.
registrarTiposF4()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
