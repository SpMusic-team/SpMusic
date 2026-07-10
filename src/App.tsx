import './App.css'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { appCopy } from '@/copy'
import { initialPlayerState } from '@/playerState'

function App() {
  const summaryItems = [
    {
      label: appCopy.summary.componentLibrary,
      value: appCopy.summary.componentLibraryValue,
    },
    {
      label: appCopy.summary.trackCount,
      value: String(initialPlayerState.tracks.length),
    },
    {
      label: appCopy.summary.spectrumBars,
      value: String(initialPlayerState.spectrumBars.length),
    },
    {
      label: appCopy.summary.playbackStatus,
      value: 'paused / playing',
    },
    {
      label: appCopy.summary.cssBaseline,
      value: appCopy.summary.cssBaselineValue,
    },
  ]

  return (
    <main className="baseline-shell" aria-labelledby="app-title">
      <section className="baseline-hero">
        <Badge variant="outline">{appCopy.productName}</Badge>
        <div>
          <h1 id="app-title">{appCopy.appTitle}</h1>
          <p>{appCopy.appIntro}</p>
        </div>
      </section>

      <section className="summary-grid" aria-label={appCopy.summaryLabel}>
        {summaryItems.map((item) => (
          <Card key={item.label}>
            <CardHeader>
              <CardDescription>{item.label}</CardDescription>
              <CardTitle>{item.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="baseline-grid" aria-label={appCopy.guardrailLabel}>
        <Card>
          <CardHeader>
            <CardTitle>{appCopy.components.title}</CardTitle>
            <CardDescription>{appCopy.components.description}</CardDescription>
          </CardHeader>
          <CardContent className="component-preview">
            <Button type="button">{appCopy.components.buttonPreview}</Button>
            <Badge>{appCopy.summary.componentLibraryValue}</Badge>
            <Badge variant="secondary">
              {appCopy.playbackStatus[initialPlayerState.playbackStatus]}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{appCopy.fixtures.title}</CardTitle>
            <CardDescription>{appCopy.fixtures.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="fixture-list">
              {initialPlayerState.tracks.map((track) => (
                <li key={track.id}>
                  <span>{track.title}</span>
                  <small>{track.artist}</small>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="guardrail-grid" aria-label={appCopy.guardrailLabel}>
        {appCopy.guardrails.map((item) => (
          <Card key={item.title} size="sm">
            <CardHeader>
              <CardTitle>{item.title}</CardTitle>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </main>
  )
}

export default App
