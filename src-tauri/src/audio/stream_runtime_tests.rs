//! Opt-in tests use the real OS output device, production HTTP/decoder and Rodio.
//! Run with `cargo test stream_runtime_tests -- --ignored --test-threads=1 --nocapture`.
use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{atomic::AtomicBool, mpsc},
    thread,
};

struct HttpFixture {
    url: String,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
impl HttpFixture {
    fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let recover_requests = Arc::new(AtomicU64::new(0));
        let worker = thread::spawn(move || {
            while !worker_stop.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let stop = worker_stop.clone();
                        let recover_requests = recover_requests.clone();
                        thread::spawn(move || {
                            stream
                                .set_read_timeout(Some(Duration::from_secs(1)))
                                .unwrap();
                            stream
                                .set_write_timeout(Some(Duration::from_millis(500)))
                                .unwrap();
                            let mut request = [0; 4096];
                            let count = stream.read(&mut request).unwrap_or(0);
                            let request = String::from_utf8_lossy(&request[..count]);
                            let bytes = wav(3);
                            let broken = request.contains("/broken.wav")
                                || (request.contains("/recover.wav")
                                    && recover_requests.fetch_add(1, Ordering::AcqRel) % 2 == 0);
                            let slow = request.contains("/slow.wav");
                            let length = if broken {
                                bytes.len() + 100_000
                            } else {
                                bytes.len()
                            };
                            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n");
                            if !slow {
                                let sent = if broken { 30_000 } else { bytes.len() };
                                let _ = stream.write_all(&bytes[..sent]);
                            }
                            let until = Instant::now()
                                + if broken {
                                    Duration::from_millis(500)
                                } else {
                                    Duration::from_secs(7)
                                };
                            while !stop.load(Ordering::Acquire) && Instant::now() < until {
                                thread::sleep(Duration::from_millis(10));
                            }
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5))
                    }
                    Err(error) => panic!("HTTP fixture: {error}"),
                }
            }
        });
        Self {
            url,
            stop,
            thread: Some(worker),
        }
    }
}
impl Drop for HttpFixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            thread.join().unwrap();
        }
    }
}
fn wav(seconds: u32) -> Vec<u8> {
    let data_len = seconds * 48_000 * 2;
    let mut bytes = Vec::with_capacity(data_len as usize + 44);
    bytes.extend(b"RIFF");
    bytes.extend((data_len + 36).to_le_bytes());
    bytes.extend(b"WAVEfmt ");
    bytes.extend(16u32.to_le_bytes());
    bytes.extend(1u16.to_le_bytes());
    bytes.extend(1u16.to_le_bytes());
    bytes.extend(48_000u32.to_le_bytes());
    bytes.extend(96_000u32.to_le_bytes());
    bytes.extend(2u16.to_le_bytes());
    bytes.extend(16u16.to_le_bytes());
    bytes.extend(b"data");
    bytes.extend(data_len.to_le_bytes());
    for i in 0..data_len / 2 {
        bytes.extend((if i % 80 < 40 { 1200i16 } else { -1200i16 }).to_le_bytes());
    }
    bytes
}

#[test]
#[ignore = "requires an actual OS audio output device; run explicitly"]
fn real_output_network_play_pause_stop_replay_and_local_replacement() {
    let fixture = HttpFixture::new();
    let mut runtime = AudioRuntime::default();
    runtime
        .ensure_output()
        .expect("an actual audio output device is required");
    runtime.volume = 0.0; // Still consumes real decoded audio through the device, without an audible test tone.
    let intent = LatestLoadAndPlayIntent::default();
    intent.register(1).unwrap();
    let url = PathBuf::from(format!("{}/good.wav", fixture.url));
    let loaded = runtime
        .load_and_play(url.clone(), 1, 90_000, &intent)
        .unwrap();
    assert_eq!(loaded.state.phase, AudioPlaybackPhase::Playing);
    assert_eq!(loaded.state.duration_ms, None);
    assert!(loaded.state.position_ms < 500);
    assert_eq!(
        runtime.current_track.as_ref().unwrap().source_kind,
        Some(super::super::types::AudioTrackSourceKind::Stream)
    );
    thread::sleep(Duration::from_millis(220));
    assert!(runtime.state().position_ms >= 150);
    assert_eq!(
        runtime
            .seek(AudioSeekInput { position_ms: 1000 })
            .unwrap_err()
            .code,
        AudioErrorCode::UnsupportedOperation
    );
    let paused = runtime.pause().unwrap().position_ms;
    thread::sleep(Duration::from_millis(100));
    assert_eq!(runtime.state().position_ms, paused);
    runtime.play(None).unwrap();
    thread::sleep(Duration::from_millis(100));
    assert_eq!(runtime.state().phase, AudioPlaybackPhase::Playing);
    runtime.stop().unwrap();
    assert_eq!(runtime.state().phase, AudioPlaybackPhase::Stopped);
    runtime
        .set_network_intent(super::super::network::cancellation_epoch())
        .unwrap();
    runtime.play(None).unwrap();
    assert_eq!(runtime.state().phase, AudioPlaybackPhase::Playing);
    let path = std::env::temp_dir().join(format!(
        "spmusic-stream-local-replacement-{}.wav",
        std::process::id()
    ));
    std::fs::write(&path, wav(1)).unwrap();
    intent.register(2).unwrap();
    super::super::network::cancel_all();
    runtime.load_and_play(path.clone(), 2, 0, &intent).unwrap();
    assert!(runtime
        .current_track
        .as_ref()
        .unwrap()
        .id
        .starts_with("local-"));
    thread::sleep(Duration::from_millis(100));
    assert_eq!(runtime.state().phase, AudioPlaybackPhase::Playing);
    runtime.stop().unwrap();
    std::fs::remove_file(path).unwrap();
}

#[test]
#[ignore = "requires an actual OS audio output device; run explicitly"]
fn real_output_midstream_failure_stays_error_after_source_is_dropped() {
    let fixture = HttpFixture::new();
    let mut runtime = AudioRuntime::default();
    runtime
        .ensure_output()
        .expect("an actual audio output device is required");
    runtime.volume = 0.0;
    let intent = LatestLoadAndPlayIntent::default();
    intent.register(1).unwrap();
    runtime
        .load_and_play(
            PathBuf::from(format!("{}/recover.wav", fixture.url)),
            1,
            0,
            &intent,
        )
        .unwrap();
    let until = Instant::now() + Duration::from_secs(3);
    while Instant::now() < until && runtime.state().phase != AudioPlaybackPhase::Error {
        thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(runtime.state().phase, AudioPlaybackPhase::Error);
    assert_eq!(
        runtime.state().error.unwrap().code,
        AudioErrorCode::PlaybackFailed
    );
    thread::sleep(Duration::from_millis(100));
    assert_eq!(
        runtime.state().phase,
        AudioPlaybackPhase::Error,
        "error must survive rodio dropping the exhausted source"
    );
    runtime
        .set_network_intent(super::super::network::cancellation_epoch())
        .unwrap();
    let retried = runtime
        .play(None)
        .expect("ordinary Play must reconnect from zero after network Error");
    assert_eq!(retried.phase, AudioPlaybackPhase::Playing);
    assert!(retried.position_ms < 300);
    runtime.stop().unwrap();
    intent.register(2).unwrap();
    runtime
        .load_and_play(
            PathBuf::from(format!("{}/recover.wav", fixture.url)),
            2,
            0,
            &intent,
        )
        .unwrap();
    let until = Instant::now() + Duration::from_secs(3);
    while Instant::now() < until && runtime.state().phase != AudioPlaybackPhase::Error {
        thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(runtime.state().phase, AudioPlaybackPhase::Error);
    runtime
        .set_network_intent(super::super::network::cancellation_epoch())
        .unwrap();
    let retried = runtime
        .transition_playback(AudioTransitionPlaybackInput {
            request_id: 1,
            expected_track_id: runtime.current_track.as_ref().unwrap().id.clone(),
            target: AudioTransportTarget::Playing,
            duration_ms: 0,
        })
        .expect("fade Play must reconnect from zero after network Error");
    assert_eq!(retried.phase, AudioPlaybackPhase::Playing);
    assert!(retried.position_ms < 300);
    assert_eq!(runtime.state().phase, AudioPlaybackPhase::Playing);
    assert!(runtime.state().error.is_none());
    runtime.stop().unwrap();
}

#[test]
#[ignore = "requires an actual OS audio output device; run explicitly"]
fn real_output_slow_replay_cancels_before_and_after_network_status_registration() {
    let fixture = HttpFixture::new();
    let epoch = super::super::network::cancellation_epoch();
    let url = format!("{}/slow.wav", fixture.url);
    let (started, observed) = mpsc::channel();
    let worker = thread::spawn(move || {
        let mut runtime = AudioRuntime::default();
        runtime
            .ensure_output()
            .expect("an actual audio output device is required");
        runtime.volume = 0.0;
        runtime.current_path = Some(PathBuf::from(&url));
        runtime.current_track = Some(playback_track_ref(Path::new(&url), None));
        runtime.phase = AudioPlaybackPhase::Stopped;
        runtime.set_network_intent(epoch).unwrap();
        started.send(()).unwrap();
        let begin = Instant::now();
        let error = runtime.play(None).unwrap_err();
        assert_eq!(error.code, AudioErrorCode::Superseded);
        assert!(begin.elapsed() < Duration::from_millis(900));
        runtime.stop().unwrap();
        assert_eq!(runtime.state().phase, AudioPlaybackPhase::Stopped);
        assert_eq!(
            runtime.set_network_intent(epoch).unwrap_err().code,
            AudioErrorCode::Superseded,
            "a stop before registration invalidates queued replay too"
        );
    });
    observed.recv_timeout(Duration::from_secs(3)).unwrap();
    thread::sleep(Duration::from_millis(100));
    let stopped = Instant::now();
    super::super::network::cancel_all();
    worker.join().unwrap();
    assert!(stopped.elapsed() < Duration::from_millis(900));
}

#[test]
#[ignore = "requires an explicitly supplied public stream URL and a real OS audio device"]
fn real_output_supplied_public_stream_plays_and_switches() {
    let url = std::env::var("SPMUSIC_PUBLIC_STREAM_URL").expect("set SPMUSIC_PUBLIC_STREAM_URL");
    let mut runtime = AudioRuntime::default();
    runtime
        .ensure_output()
        .expect("an actual audio output device is required");
    runtime.volume = 0.0;
    let intent = LatestLoadAndPlayIntent::default();
    intent.register(1).unwrap();
    let started = Instant::now();
    let loaded = runtime
        .load_and_play(PathBuf::from(&url), 1, 0, &intent)
        .expect("public stream should enter real Rodio playback");
    eprintln!(
        "real public stream entered Playing in {:?}",
        started.elapsed()
    );
    if let Ok(expected) = std::env::var("SPMUSIC_EXPECTED_STATION_NAME") {
        let track = runtime
            .get_current_track()
            .expect("loaded public stream track");
        assert_eq!(track.station_name.as_deref(), Some(expected.as_str()));
        assert_eq!(track.metadata.title.as_deref(), Some(expected.as_str()));
        eprintln!("public station metadata: {:?}", track.station_name);
    }
    assert_eq!(loaded.state.phase, AudioPlaybackPhase::Playing);
    assert_eq!(loaded.state.duration_ms, None);
    let until = Instant::now() + Duration::from_secs(12);
    while Instant::now() < until {
        thread::sleep(Duration::from_millis(100));
        let state = runtime.state();
        assert_eq!(state.phase, AudioPlaybackPhase::Playing, "{state:?}");
        assert!(state.error.is_none());
    }
    runtime.pause().unwrap();
    thread::sleep(Duration::from_millis(150));
    assert_eq!(
        runtime.play(None).unwrap().phase,
        AudioPlaybackPhase::Playing
    );
    runtime.stop().unwrap();
    assert_eq!(runtime.state().phase, AudioPlaybackPhase::Stopped);
    let local = std::env::temp_dir().join(format!(
        "spmusic-public-stream-switch-{}.wav",
        std::process::id()
    ));
    std::fs::write(&local, wav(1)).unwrap();
    intent.register(2).unwrap();
    let replaced = runtime.load_and_play(local.clone(), 2, 0, &intent).unwrap();
    assert_eq!(replaced.state.phase, AudioPlaybackPhase::Playing);
    assert_ne!(replaced.track_id, loaded.track_id);
    runtime.stop().unwrap();
    std::fs::remove_file(local).unwrap();
}
