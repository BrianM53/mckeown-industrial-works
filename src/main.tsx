import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/barlow/400.css'
import '@fontsource/barlow/600.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@/styles/tokens.css'
import '@/styles/global.css'
import { recordDebugError } from '@/core/debug'
import App from '@/app/App'

window.addEventListener('error', (e) => recordDebugError(`[window.error] ${e.message}`))
window.addEventListener('unhandledrejection', (e) => recordDebugError(`[unhandledrejection] ${String((e as PromiseRejectionEvent).reason)}`))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
