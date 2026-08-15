import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/pixelify-sans/400.css'
import '@fontsource/pixelify-sans/600.css'
import './styles.css'
import './story/story.css'
import { App } from './App'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./service-worker.js', { scope: './' })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
