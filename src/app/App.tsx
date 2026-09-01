import { AppearanceProvider } from '@/features/appearance/components/AppearanceProvider'
import { PlayerShell } from '@/features/player/components/PlayerShell'
import { Toaster } from '@/components/ui/sonner'

function App() {
  return (
    <AppearanceProvider>
      <PlayerShell />
      <Toaster position="bottom-right" />
    </AppearanceProvider>
  )
}

export default App
