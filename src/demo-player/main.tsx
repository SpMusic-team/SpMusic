import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from '@/components/ui/sonner'
import { AppearanceProvider } from '@/features/appearance/components/AppearanceProvider'
import { DemoPlayerPage } from '@/demo/player/DemoPlayerPage'
import '@/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppearanceProvider>
      <DemoPlayerPage />
      <Toaster position="bottom-right" />
    </AppearanceProvider>
  </StrictMode>,
)
