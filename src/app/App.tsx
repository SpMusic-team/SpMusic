import { AppearanceProvider } from '@/features/appearance/components/AppearanceProvider'
import { PlayerShell } from '@/features/player/components/PlayerShell'

function App() {
  return (
    <AppearanceProvider>
      <PlayerShell />
    </AppearanceProvider>
  )
}

export default App
