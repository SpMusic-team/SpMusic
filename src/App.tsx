import './App.css'
import { appCopy } from './copy'
import { initialPlayerState } from './playerState'

function App() {
  const currentTrack = initialPlayerState.tracks.find(
    (track) => track.id === initialPlayerState.currentTrackId,
  )

  const summaryItems = [
    {
      label: appCopy.summary.trackCount,
      value: String(initialPlayerState.tracks.length),
    },
    {
      label: appCopy.summary.initialStatus,
      value: appCopy.playbackStatus[initialPlayerState.playbackStatus],
    },
    {
      label: appCopy.summary.currentTrack,
      value: currentTrack?.title ?? appCopy.summary.noCurrentTrack,
    },
    {
      label: appCopy.summary.progress,
      value: `${initialPlayerState.progressSeconds}s`,
    },
    {
      label: appCopy.summary.spectrumBars,
      value: String(initialPlayerState.spectrumBars.length),
    },
  ]

  return (
    <main className="foundation-shell" aria-labelledby="app-title">
      <header className="foundation-header">
        <p className="eyebrow">{appCopy.productName}</p>
        <h1 id="app-title">{appCopy.foundationTitle}</h1>
        <p>{appCopy.foundationIntro}</p>
      </header>

      <section className="summary-strip" aria-label={appCopy.summaryLabel}>
        {summaryItems.map((item) => (
          <div className="summary-item" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </section>

      <section className="foundation-grid" aria-label={appCopy.guardrailLabel}>
        {appCopy.guardrails.map((item) => (
          <article className="guardrail" key={item.title}>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
          </article>
        ))}
      </section>

      <section className="fixture-preview" aria-labelledby="fixture-title">
        <div>
          <p className="eyebrow">{appCopy.fixture.eyebrow}</p>
          <h2 id="fixture-title">{appCopy.fixture.title}</h2>
        </div>
        <ul>
          {initialPlayerState.tracks.map((track) => (
            <li key={track.id}>
              <span>{track.title}</span>
              <small>
                {track.artist} / {track.album}
              </small>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

export default App
