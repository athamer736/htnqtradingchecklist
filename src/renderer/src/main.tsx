import './webShim'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ConfirmProvider } from './components/ConfirmProvider'
import './index.css'
import { initTheme } from './store/useTheme'

// Apply the saved colours before anything is drawn.
initTheme()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </React.StrictMode>
)
