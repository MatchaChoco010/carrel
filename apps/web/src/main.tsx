import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'

// Electron のウィンドウから開かれたときだけ透過モードにする。ブラウザで開くと
// 背後に何も無いため、透過のままでは白く抜けてしまう。
if (new URLSearchParams(window.location.search).get('surface') === 'desktop') {
  document.documentElement.dataset['surface'] = 'desktop'
}

const root = document.getElementById('root')
if (root === null) throw new Error('#root が見つからない')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
