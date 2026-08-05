import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'
// タブに出すアイコン。
// index.html から相対で辿ると vite の開発用サーバーでは届かないので、ここから読む。
import iconUrl from '../../../logo/logo.png'

const icon = document.createElement('link')
icon.rel = 'icon'
icon.type = 'image/png'
icon.href = iconUrl
document.head.append(icon)

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
