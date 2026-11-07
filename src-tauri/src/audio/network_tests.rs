//! Independent transport acceptance with actual HTTP bytes and the production decoder.
use super::*;
use std::{
    io::Write,
    net::{TcpListener, TcpStream},
    sync::atomic::AtomicUsize,
    time::Instant,
};

fn serial() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

struct Server {
    url: String,
    stop: Arc<AtomicBool>,
    requests: Arc<AtomicUsize>,
    worker: Option<thread::JoinHandle<()>>,
}

impl Server {
    fn new(handler: impl FnOnce(TcpStream, Arc<AtomicBool>) + Send + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/audio.wav", listener.local_addr().unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let requests = Arc::new(AtomicUsize::new(0));
        let worker_stop = stop.clone();
        let worker_requests = requests.clone();
        let worker = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline && !worker_stop.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream
                            .set_read_timeout(Some(Duration::from_secs(2)))
                            .unwrap();
                        stream
                            .set_write_timeout(Some(Duration::from_millis(500)))
                            .unwrap();
                        let mut request = [0; 4096];
                        // TCP may split headers across reads. Closing a socket
                        // with unread request bytes can reset an otherwise
                        // complete response on Windows and make EOF tests flaky.
                        let mut count = 0;
                        loop {
                            match stream.read(&mut request[count..]) {
                                Ok(0) | Err(_) => return,
                                Ok(read) => count += read,
                            }
                            if request[..count].windows(4).any(|part| part == b"\r\n\r\n") {
                                break;
                            }
                            if count == request.len() { return; }
                        }
                        worker_requests.fetch_add(1, Ordering::AcqRel);
                        handler(stream, worker_stop);
                        return;
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5))
                    }
                    Err(error) => panic!("test listener: {error}"),
                }
            }
        });
        Self {
            url,
            stop,
            requests,
            worker: Some(worker),
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            worker.join().unwrap();
        }
    }
}

fn wav(seconds: usize) -> Vec<u8> {
    let samples = seconds * 48_000;
    let data_len = (samples * 2) as u32;
    let mut bytes = Vec::with_capacity(data_len as usize + 44);
    bytes.extend(b"RIFF");
    bytes.extend((36 + data_len).to_le_bytes());
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
    for index in 0..samples {
        bytes.extend((if index % 80 < 40 { 1200i16 } else { -1200i16 }).to_le_bytes());
    }
    bytes
}

fn header(stream: &mut TcpStream, length: usize) {
    write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n").unwrap();
}

fn wait_or_stop(stop: &AtomicBool, duration: Duration) {
    let until = Instant::now() + duration;
    while Instant::now() < until && !stop.load(Ordering::Acquire) {
        thread::sleep(Duration::from_millis(10));
    }
}

fn drain_until(
    source: &mut AudioSource,
    status: &StreamStatus,
    timeout: Duration,
) -> Option<AudioCommandError> {
    let until = Instant::now() + timeout;
    while Instant::now() < until {
        for _ in 0..8192 {
            if source.next().is_none() {
                return status.error();
            }
        }
        if let Some(error) = status.error() {
            return Some(error);
        }
        thread::sleep(Duration::from_millis(2));
    }
    panic!("network source did not terminate within {timeout:?}");
}

#[test]
fn real_http_wav_decodes_nonzero_pcm_and_normal_eof() {
    let _serial = serial();
    let bytes = wav(1);
    let server = Server::new(move |mut stream, _| {
        header(&mut stream, bytes.len());
        stream.write_all(&bytes).unwrap();
    });
    let (mut source, status) = open_with_status(Path::new(&server.url), || false).unwrap();
    assert_eq!(server.requests.load(Ordering::Acquire), 1);
    assert_eq!(source.channels(), 1);
    assert_eq!(source.sample_rate(), 48_000);
    assert_eq!(
        source.total_duration(),
        None,
        "network duration remains unknown"
    );
    assert!(
        (0..4096)
            .filter_map(|_| source.next())
            .any(|sample| sample != 0),
        "real decoder must emit nonzero PCM"
    );
    assert!(drain_until(&mut source, &status, Duration::from_secs(3)).is_none());
}

#[test]
fn finite_wav_audio_end_does_not_require_consuming_trailing_padding() {
    let _serial = serial();
    let mut bytes = wav(1);
    let padding = 262_144u32;
    let full_len = bytes.len() + 8 + padding as usize;
    bytes[4..8].copy_from_slice(&((full_len - 8) as u32).to_le_bytes());
    bytes.extend(b"JUNK");
    bytes.extend(padding.to_le_bytes());
    let server = Server::new(move |mut stream, stop| {
        header(&mut stream, full_len);
        let _ = stream.write_all(&bytes);
        // All declared audio samples arrived. Valid, unused RIFF padding need
        // not delay the format's natural audio EOF until the HTTP read timeout.
        wait_or_stop(&stop, Duration::from_secs(9));
    });
    let (mut source, status) = open_with_status(Path::new(&server.url), || false).unwrap();
    assert!(drain_until(&mut source, &status, Duration::from_secs(3)).is_none());
}

#[test]
fn progress_continues_beyond_five_seconds_without_total_lifetime_timeout() {
    let _serial = serial();
    let bytes = wav(8);
    let server = Server::new(move |mut stream, stop| {
        header(&mut stream, bytes.len());
        if stream.write_all(&bytes[..131_072]).is_err() {
            return;
        }
        for part in bytes[131_072..].chunks(49_152) {
            wait_or_stop(&stop, Duration::from_millis(500));
            if stop.load(Ordering::Acquire) || stream.write_all(part).is_err() {
                return;
            }
        }
    });
    let started = Instant::now();
    let (mut source, status) = open_with_status(Path::new(&server.url), || false).unwrap();
    let result = drain_until(&mut source, &status, Duration::from_secs(12));
    assert!(result.is_none(), "progressing stream failed: {result:?}");
    assert!(
        started.elapsed() > Duration::from_secs(5),
        "fixture must cross the five-second boundary"
    );
}

#[test]
fn stalled_response_reports_playback_failed_instead_of_clean_eof() {
    let _serial = serial();
    let bytes = wav(20);
    let server = Server::new(move |mut stream, stop| {
        header(&mut stream, bytes.len());
        if stream.write_all(&bytes[..131_072]).is_err() {
            return;
        }
        wait_or_stop(&stop, Duration::from_secs(9));
    });
    let (mut source, status) = open_with_status(Path::new(&server.url), || false).unwrap();
    let started = Instant::now();
    let error = drain_until(&mut source, &status, Duration::from_secs(8))
        .expect("stalled HTTP read must be an error");
    assert_eq!(error.code, AudioErrorCode::PlaybackFailed);
    assert!(started.elapsed() < Duration::from_secs(8));
}

#[test]
fn callback_cancels_slow_first_frame_without_waiting_for_network_timeout() {
    let _serial = serial();
    let server = Server::new(move |_stream, stop| wait_or_stop(&stop, Duration::from_secs(9)));
    let started = Instant::now();
    let error = match open_with_status(Path::new(&server.url), || {
        started.elapsed() > Duration::from_millis(100)
    }) {
        Ok(_) => panic!("slow first frame unexpectedly succeeded"),
        Err(error) => error,
    };
    assert_eq!(error.code, AudioErrorCode::Superseded);
    assert!(
        started.elapsed() < Duration::from_millis(750),
        "cancellation must not wait five seconds"
    );
}

#[test]
fn truncated_content_length_is_not_reported_as_normal_end() {
    let _serial = serial();
    let bytes = wav(20);
    let server = Server::new(move |mut stream, stop| {
        header(&mut stream, bytes.len());
        let _ = stream.write_all(&bytes[..131_072]);
        // Keep the connection alive until the initial PCM is prepared, then
        // violate Content-Length during playback rather than during startup.
        wait_or_stop(&stop, Duration::from_millis(300));
    });
    let (mut source, status) = open_with_status(Path::new(&server.url), || false).unwrap();
    let error = drain_until(&mut source, &status, Duration::from_secs(3))
        .expect("truncated HTTP body must expose a transport failure");
    assert_eq!(error.code, AudioErrorCode::PlaybackFailed);
}

#[test]
fn complete_http_response_with_truncated_wav_audio_is_still_an_error() {
    let _serial = serial();
    let bytes = wav(20);
    let server = Server::new(move |mut stream, _| {
        // HTTP framing is valid, but the WAV data header still declares twenty
        // seconds while only one second of audio was delivered.
        header(&mut stream, 96_044);
        let _ = stream.write_all(&bytes[..96_044]);
    });
    let error = match open_with_status(Path::new(&server.url), || false) {
        Ok((mut source, status)) => drain_until(&mut source, &status, Duration::from_secs(3))
            .expect("truncated audio container cannot become normal EOF"),
        Err(error) => error,
    };
    assert_eq!(error.code, AudioErrorCode::PlaybackFailed);
}

#[test]
fn http_status_and_initial_read_timeout_have_playback_error_semantics() {
    let _serial = serial();
    let server = Server::new(move |mut stream, _| {
        let _ = stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    });
    let error = match open_with_status(Path::new(&server.url), || false) {
        Ok(_) => panic!("404 succeeded"),
        Err(error) => error,
    };
    assert_eq!(error.code, AudioErrorCode::PlaybackFailed);
    assert!(
        !error.message.contains(&server.url),
        "error must redact the requested URL"
    );
    drop(server);
    let server = Server::new(move |mut stream, stop| {
        header(&mut stream, 4096);
        wait_or_stop(&stop, Duration::from_secs(9));
    });
    let error = match open_with_status(Path::new(&server.url), || false) {
        Ok(_) => panic!("stalled first frame succeeded"),
        Err(error) => error,
    };
    assert_eq!(
        error.code,
        AudioErrorCode::PlaybackFailed,
        "initial read timeout is not unsupported format"
    );
}

#[test]
fn same_url_sessions_are_all_cancelled() {
    let _serial = serial();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/audio.wav", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = stop.clone();
    let worker = thread::spawn(move || {
        let mut handlers = Vec::new();
        while !worker_stop.load(Ordering::Acquire) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let stop = worker_stop.clone();
                    handlers.push(thread::spawn(move || {
                        let bytes = wav(20);
                        stream
                            .set_write_timeout(Some(Duration::from_millis(500)))
                            .unwrap();
                        let mut request = [0; 4096];
                        let _ = stream.read(&mut request);
                        header(&mut stream, bytes.len());
                        let _ = stream.write_all(&bytes[..131_072]);
                        wait_or_stop(&stop, Duration::from_secs(9));
                    }));
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(error) => panic!("test listener: {error}"),
            }
        }
        for handler in handlers {
            handler.join().unwrap();
        }
    });
    let (_first, first_status) = open_with_status(Path::new(&url), || false).unwrap();
    let (_second, second_status) = open_with_status(Path::new(&url), || false).unwrap();
    cancel_all();
    let first_cancelled = first_status.cancelled();
    let second_cancelled = second_status.cancelled();
    stop.store(true, Ordering::Release);
    worker.join().unwrap();
    assert!(
        first_cancelled,
        "same URL must not replace an earlier session's cancellation token"
    );
    assert!(second_cancelled);
}

#[test]
fn existing_playback_response_exposes_only_valid_station_name_without_extra_requests() {
    let _serial = serial();
    let cases: Vec<(Option<Vec<u8>>, Option<&str>)> = vec![
        (
            Some(b"  Groove Salad [SomaFM]  ".to_vec()),
            Some("Groove Salad [SomaFM]"),
        ),
        (
            Some("电台 A <测试>".as_bytes().to_vec()),
            Some("电台 A <测试>"),
        ),
        (None, None),
        (Some(b"   ".to_vec()), None),
        (Some(vec![b'A'; 1025]), None),
        (Some(vec![0xff, 0xfe]), None),
    ];
    for (index, (name, expected)) in cases.into_iter().enumerate() {
        let server = Server::new(move |mut stream, _| {
            let bytes = wav(1);
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: {}\r\n",
                bytes.len()
            )
            .unwrap();
            if let Some(name) = name {
                stream.write_all(b"icy-name: ").unwrap();
                stream.write_all(&name).unwrap();
                stream.write_all(b"\r\n").unwrap();
            }
            stream.write_all(b"\r\n").unwrap();
            stream.write_all(&bytes).unwrap();
        });
        let (source, status) = open_with_status(Path::new(&server.url), || false)
            .unwrap_or_else(|error| panic!("header case {index} failed: {error:?}"));
        assert_eq!(status.station_name().as_deref(), expected);
        assert_eq!(
            server.requests.load(Ordering::Acquire),
            1,
            "metadata reuses the playback response"
        );
        drop(source);
    }
    // The HTTP transport rejects control-byte headers before exposing a
    // Response. Check the metadata validator directly for such raw text.
    assert_eq!(valid_station_name("Bad\tName"), None);
    assert_eq!(valid_station_name("Bad\nName"), None);
}

#[test]
#[ignore = "requires an explicitly supplied public stream URL"]
fn supplied_public_stream_decodes_pcm() {
    let _serial = serial();
    let url = std::env::var("SPMUSIC_PUBLIC_STREAM_URL").expect("set SPMUSIC_PUBLIC_STREAM_URL");
    let started = Instant::now();
    let (mut source, status) = open_with_status(Path::new(&url), || {
        started.elapsed() > Duration::from_secs(15)
    })
    .unwrap_or_else(|error| {
        panic!(
            "production stream open failed after {:?}: {error:?}",
            started.elapsed()
        )
    });
    eprintln!(
        "opened production stream after {:?}, {} channels / {} Hz",
        started.elapsed(),
        source.channels(),
        source.sample_rate()
    );
    if let Ok(expected) = std::env::var("SPMUSIC_EXPECTED_STATION_NAME") {
        assert_eq!(status.station_name().as_deref(), Some(expected.as_str()));
    }
    let until = Instant::now() + Duration::from_secs(12);
    let mut nonzero = 0usize;
    while Instant::now() < until {
        for _ in 0..4096 {
            if source.next().expect("live stream unexpectedly ended") != 0 {
                nonzero += 1;
            }
        }
        assert!(
            status.error().is_none(),
            "stream error: {:?}",
            status.error()
        );
        thread::sleep(Duration::from_millis(20));
    }
    assert!(
        nonzero > 0,
        "real public audio should contain nonzero decoded PCM"
    );
    status.cancel();
    assert!(source.next().is_none());
    let until = Instant::now() + Duration::from_secs(6);
    while !status.worker_finished.load(Ordering::Acquire) && Instant::now() < until {
        thread::sleep(POLL);
    }
    assert!(
        status.worker_finished.load(Ordering::Acquire),
        "cancelled decoder worker must exit"
    );
}

#[test]
#[ignore = "diagnoses an explicitly supplied finite audio capture without committing broadcast data"]
fn supplied_capture_decodes_pcm() {
    let path =
        std::env::var("SPMUSIC_CAPTURED_STREAM_FILE").expect("set SPMUSIC_CAPTURED_STREAM_FILE");
    let bytes = std::fs::read(path).unwrap();
    let mut decoder = SymphoniaAudioSource::open_stream(
        Path::new("groovesalad-128-aac"),
        Box::new(io::Cursor::new(bytes)),
    )
    .unwrap_or_else(|error| panic!("captured stream decoder error: {error:?}"));
    assert!(decoder.by_ref().take(4096).any(|sample| sample != 0));
}

#[test]
fn extensionless_mpeg2_aac_stream_decodes_synthetic_pcm() {
    let _serial = serial();
    let bytes = include_bytes!("test-fixtures/synthetic-mpeg2-aac-lc.aac");
    let server = Server::new(move |mut stream, stop| {
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: audio/aac\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len()).unwrap();
        stream.write_all(bytes).unwrap();
        wait_or_stop(&stop, Duration::from_secs(2));
    });
    let url = server.url.replace("/audio.wav", "/groovesalad-128-aac");
    let (mut source, status) = open_with_status(Path::new(&url), || false)
        .expect("MPEG-2 ADTS with no filename extension must decode");
    assert_eq!(source.sample_rate(), 44100);
    assert_eq!(source.channels(), 2);
    assert_eq!(source.total_duration(), None);
    assert!(source.by_ref().take(4096).any(|sample| sample != 0));
    assert!(status.error().is_none());
    status.cancel();
    let until = Instant::now() + Duration::from_secs(6);
    while !status.worker_finished.load(Ordering::Acquire) && Instant::now() < until {
        thread::sleep(POLL);
    }
    assert!(status.worker_finished.load(Ordering::Acquire));
}

#[test]
fn icy_aac_http_metadata_is_removed_before_decoder_and_author_is_available() {
    let _serial = serial();
    let bytes = include_bytes!("test-fixtures/synthetic-mpeg2-aac-lc.aac");
    let server = Server::new(move |mut stream, stop| {
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: audio/aac\r\nicy-metaint: 97\r\nConnection: close\r\n\r\n").unwrap();
        for chunk in bytes.chunks(97) {
            if stream.write_all(chunk).is_err() { return; }
            if chunk.len() == 97 {
                let mut metadata = [0; 32];
                let title = b"StreamTitle='Artist - Song';";
                metadata[..title.len()].copy_from_slice(title);
                if stream.write_all(&[2]).and_then(|_| stream.write_all(&metadata)).is_err() { return; }
            }
        }
        wait_or_stop(&stop, Duration::from_secs(2));
    });
    let url = server.url.replace("/audio.wav", "/live-aac");
    let (mut source, status) = open_with_status(Path::new(&url), || false).unwrap();
    let mut expected = SymphoniaAudioSource::open_stream(Path::new("live-aac"), Box::new(io::Cursor::new(bytes.to_vec()))).unwrap();
    let actual = source.by_ref().take(4096).collect::<Vec<_>>();
    assert_eq!(actual, expected.by_ref().take(4096).collect::<Vec<_>>());
    assert!(actual.iter().any(|sample| *sample != 0));
    assert_eq!(status.artist(), Some(Some("Artist".into())));
    status.cancel();
}

#[test]
fn icy_http_truncated_metadata_is_a_playback_error_not_clean_eof() {
    let _serial = serial();
    let server = Server::new(move |mut stream, _| {
        let bytes = wav(2);
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nicy-metaint: 32768\r\nConnection: close\r\n\r\n").unwrap();
        stream.write_all(&bytes[..32768]).unwrap();
        stream.write_all(b"\x02short").unwrap();
    });
    match open_with_status(Path::new(&server.url), || false) {
        Ok((mut source, status)) => {
            while source.next().is_some() {}
            assert!(status.error().is_some(), "metadata truncation must not become a clean end");
        }
        Err(error) => assert_eq!(error.code, AudioErrorCode::PlaybackFailed),
    }
}

#[test]
fn icy_http_author_updates_zero_block_and_title_without_author_clear() {
    let _serial = serial();
    let server = Server::new(move |mut stream, _| {
        write!(stream, "HTTP/1.1 200 OK\r\nicy-metaint: 4\r\nConnection: close\r\n\r\n").unwrap();
        let fields: [&[u8]; 4] = [b"StreamTitle='First - Song';", b"", b"Artist='Second';", b"StreamTitle='Title only';"];
        for (audio, field) in [b"abcd", b"efgh", b"ijkl", b"mnop"].iter().zip(fields) {
            stream.write_all(*audio).unwrap();
            let length = field.len().div_ceil(16);
            stream.write_all(&[length as u8]).unwrap();
            let mut block = vec![0; length * 16];
            block[..field.len()].copy_from_slice(field);
            // Exercise short TCP writes inside the metadata fields.
            for chunk in block.chunks(3) { stream.write_all(chunk).unwrap(); }
        }
        stream.write_all(b"qrst").unwrap();
    });
    let response = reqwest::blocking::get(&server.url).unwrap();
    let status = Arc::new(StreamStatus::default());
    let source = HttpMediaSource { response, status: status.clone() };
    let mut reader = super::super::network_icy::IcyReader::new(source, Some(4), status.clone());
    let mut audio = [0; 4];
    reader.read_exact(&mut audio).unwrap();
    assert_eq!(&audio, b"abcd");
    assert_eq!(status.artist(), None);
    reader.read_exact(&mut audio).unwrap();
    assert_eq!(&audio, b"efgh");
    assert_eq!(status.artist(), Some(Some("First".into())));
    reader.read_exact(&mut audio).unwrap();
    assert_eq!(&audio, b"ijkl");
    assert_eq!(status.artist(), Some(Some("First".into())));
    reader.read_exact(&mut audio).unwrap();
    assert_eq!(&audio, b"mnop");
    assert_eq!(status.artist(), Some(Some("Second".into())));
    reader.read_exact(&mut audio).unwrap();
    assert_eq!(&audio, b"qrst");
    assert_eq!(status.artist(), Some(None));
}

#[test]
fn invalid_continuous_stream_has_a_probe_byte_budget() {
    let _serial = serial();
    let server = Server::new(move |mut stream, stop| {
        header(&mut stream, 1024 * 1024);
        while !stop.load(Ordering::Acquire) {
            if stream.write_all(&[b'Z'; 8192]).is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
    });
    let started = Instant::now();
    let error = match open_with_status(Path::new(&server.url), || false) {
        Ok(_) => panic!("invalid stream became playable"),
        Err(error) => error,
    };
    assert_eq!(error.code, AudioErrorCode::UnsupportedFormat);
    assert!(error.message.contains("256 KiB"));
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[test]
fn slowly_progressing_invalid_stream_has_a_preparation_deadline() {
    let _serial = serial();
    let server = Server::new(move |mut stream, stop| {
        header(&mut stream, 1024 * 1024);
        while !stop.load(Ordering::Acquire) {
            if stream.write_all(&[b'Z'; 512]).is_err() {
                break;
            }
            wait_or_stop(&stop, Duration::from_millis(100));
        }
    });
    let started = Instant::now();
    let error = match open_with_status(Path::new(&server.url), || false) {
        Ok(_) => panic!("invalid stream became playable"),
        Err(error) => error,
    };
    assert_eq!(error.code, AudioErrorCode::PlaybackFailed);
    assert!(error.message.contains("准备超时"));
    assert!(started.elapsed() >= PREPARATION_TIMEOUT);
    assert!(
        started.elapsed() < Duration::from_secs(12),
        "caller must not wait for a network read after the preparation deadline"
    );
}
