import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// DM Sans (body) and JetBrains Mono (code) are bundled. General Sans (headings) loads from Fontshare in index.html, and
// headings fall back to bold DM Sans until it arrives.
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/jetbrains-mono/400.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
