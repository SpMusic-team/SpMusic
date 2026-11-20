//! HTTP transport and decoding stay off the audio callback and control thread.
//! The PCM queue holds at most 8 * 4096 i16 samples (64 KiB), plus one producer
//! and one consumer chunk. Neither finite files nor live streams are downloaded.
use std::{
    io::{self, Read, Seek, SeekFrom},
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender, TryRecvError, TrySendError},
        Arc, Mutex, OnceLock, Weak,
    },
    thread,
    time::{Duration, Instant},
};

use rodio::Source;
use symphonia::core::{errors::Error as DecodeError, io::MediaSource};

use super::{
    error::{audio_error, AudioCommandError, AudioErrorCode},
    source::AudioSource,
    symphonia_source::SymphoniaAudioSource,
};

const CHUNK_SAMPLES: usize = 4096;
const QUEUE_CHUNKS: usize = 8;
const IO_TIMEOUT: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(10);
const PREPARATION_TIMEOUT: Duration = Duration::from_secs(10);
const PREPARATION_BYTES: u64 = 256 * 1024;

pub(crate) struct StreamStatus {
    station_name: Mutex<Option<String>>,
    artist: Mutex<Option<Option<String>>>,
    cancelled: AtomicBool,
    error: Mutex<Option<AudioCommandError>>,
    bytes_read: AtomicU64,
    clean_eof: AtomicBool,
    prepared: AtomicBool,
    preparation_started: Instant,
    #[cfg(test)]
    worker_finished: AtomicBool,
}

impl Default for StreamStatus {
    fn default() -> Self {
        Self {
            station_name: Mutex::new(None),
            artist: Mutex::new(None),
            cancelled: AtomicBool::new(false),
            error: Mutex::new(None),
            bytes_read: AtomicU64::new(0),
            clean_eof: AtomicBool::new(false),
            prepared: AtomicBool::new(false),
            preparation_started: Instant::now(),
            #[cfg(test)]
            worker_finished: AtomicBool::new(false),
        }
    }
}

impl StreamStatus {
    pub(crate) fn artist(&self) -> Option<Option<String>> {
        self.artist.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
    pub(super) fn set_artist(&self, artist: Option<String>) {
        *self.artist.lock().unwrap_or_else(|p| p.into_inner()) = Some(artist);
    }
    pub(crate) fn station_name(&self) -> Option<String> {
        self.station_name
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }
    pub(crate) fn error(&self) -> Option<AudioCommandError> {
        self.error.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
    fn cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
    pub(crate) fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }
    pub(super) fn fail(&self, message: impl Into<String>) {
        let mut error = self.error.lock().unwrap_or_else(|p| p.into_inner());
        if error.is_none() && !self.cancelled() {
            *error = Some(audio_error(AudioErrorCode::PlaybackFailed, message, true));
        }
    }
    fn preparation_error(&self) -> Option<AudioCommandError> {
        if self.prepared.load(Ordering::Acquire) {
            return None;
        }
        if self.preparation_started.elapsed() >= PREPARATION_TIMEOUT {
            Some(audio_error(
                AudioErrorCode::PlaybackFailed,
                "网络流准备超时（10 秒内未能解码音频）",
                true,
            ))
        } else if self.bytes_read.load(Ordering::Acquire) >= PREPARATION_BYTES {
            Some(audio_error(
                AudioErrorCode::UnsupportedFormat,
                "未能识别网络流音频（探测超过 256 KiB）",
                true,
            ))
        } else {
            None
        }
    }
}

fn sessions() -> &'static Mutex<Vec<Weak<StreamStatus>>> {
    static SESSIONS: OnceLock<Mutex<Vec<Weak<StreamStatus>>>> = OnceLock::new();
    SESSIONS.get_or_init(Default::default)
}

static CANCELLATION_EPOCH: AtomicU64 = AtomicU64::new(0);
pub(crate) fn cancellation_epoch() -> u64 {
    CANCELLATION_EPOCH.load(Ordering::Acquire)
}

pub(crate) fn cancel_all() {
    CANCELLATION_EPOCH.fetch_add(1, Ordering::AcqRel);
    let mut sessions = sessions().lock().unwrap_or_else(|p| p.into_inner());
    sessions.retain(|status| {
        if let Some(status) = status.upgrade() {
            status.cancel();
            true
        } else {
            false
        }
    });
}

pub(crate) fn is_stream(value: &str) -> bool {
    value
        .get(..7)
        .is_some_and(|p| p.eq_ignore_ascii_case("http://"))
        || value
            .get(..8)
            .is_some_and(|p| p.eq_ignore_ascii_case("https://"))
}

pub(crate) fn canonical_url(value: &str) -> Result<String, AudioCommandError> {
    if value.len() > 8192 || value.chars().any(char::is_control) || value.contains('\\') {
        return Err(audio_error(
            AudioErrorCode::InvalidPath,
            "流地址格式无效",
            true,
        ));
    }
    let mut url = tauri::Url::parse(value.trim()).map_err(|_| {
        audio_error(
            AudioErrorCode::InvalidPath,
            "请输入有效的 HTTP(S) 流地址",
            true,
        )
    })?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(audio_error(
            AudioErrorCode::InvalidPath,
            "只支持不包含用户凭据的 HTTP(S) 流地址",
            true,
        ));
    }
    url.set_fragment(None);
    let normalized: String = url.into();
    if normalized.len() > 8192 {
        return Err(audio_error(
            AudioErrorCode::InvalidPath,
            "流地址超过 8192 字节",
            true,
        ));
    }
    Ok(normalized)
}

pub(crate) fn stream_id(url: &str) -> String {
    format!("stream-{}", &blake3::hash(url.as_bytes()).to_hex()[..16])
}

pub(crate) fn display_name(url: &str) -> String {
    url.to_owned()
}

/// Untrusted HTTP metadata is display text, never markup or a playback address.
pub(crate) fn valid_station_name(value: &str) -> Option<String> {
    if value.chars().any(char::is_control) {
        return None;
    }
    let value = value.trim();
    (!value.is_empty() && value.len() <= 1024).then(|| value.to_owned())
}

struct HttpMediaSource {
    response: reqwest::blocking::Response,
    status: Arc<StreamStatus>,
}

impl Read for HttpMediaSource {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        if self.status.cancelled() {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "stream cancelled",
            ));
        }
        if let Some(error) = self.status.preparation_error() {
            *self.status.error.lock().unwrap_or_else(|p| p.into_inner()) = Some(error);
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "network audio preparation budget exceeded",
            ));
        }
        let limit = if self.status.prepared.load(Ordering::Acquire) {
            bytes.len()
        } else {
            bytes
                .len()
                .min((PREPARATION_BYTES - self.status.bytes_read.load(Ordering::Acquire)) as usize)
        };
        match self.response.read(&mut bytes[..limit]) {
            Ok(0) => {
                self.status.clean_eof.store(true, Ordering::Release);
                Ok(0)
            }
            Ok(count) => {
                self.status
                    .bytes_read
                    .fetch_add(count as u64, Ordering::Relaxed);
                Ok(count)
            }
            Err(error) => {
                let timeout = error.kind() == io::ErrorKind::TimedOut
                    || error
                        .get_ref()
                        .and_then(|e| e.downcast_ref::<reqwest::Error>())
                        .is_some_and(reqwest::Error::is_timeout);
                self.status.fail(if timeout {
                    "网络流读取超时（5 秒无数据）"
                } else {
                    "网络流连接中断或响应不完整"
                });
                Err(error)
            }
        }
    }
}
impl Seek for HttpMediaSource {
    fn seek(&mut self, _: SeekFrom) -> io::Result<u64> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "network streams are not seekable",
        ))
    }
}
impl MediaSource for HttpMediaSource {
    fn is_seekable(&self) -> bool {
        false
    }
    fn byte_len(&self) -> Option<u64> {
        None
    }
}

pub(crate) fn open(
    path: &Path,
    cancelled: impl Fn() -> bool,
) -> Result<AudioSource, AudioCommandError> {
    open_with_status(path, cancelled).map(|(source, _)| source)
}

pub(crate) fn open_with_status(
    path: &Path,
    cancelled: impl Fn() -> bool,
) -> Result<(AudioSource, Arc<StreamStatus>), AudioCommandError> {
    let url = canonical_url(&path.to_string_lossy())?;
    let status = Arc::new(StreamStatus::default());
    {
        let mut sessions = sessions().lock().unwrap_or_else(|p| p.into_inner());
        sessions.retain(|session| session.strong_count() != 0);
        sessions.push(Arc::downgrade(&status));
    }
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let (pcm_tx, pcm_rx) = mpsc::sync_channel(QUEUE_CHUNKS);
    let worker_status = status.clone();
    thread::Builder::new()
        .name("network-audio-decoder".into())
        .spawn(move || {
            let result = decode_stream(&url, &worker_status, &ready_tx, &pcm_tx);
            if let Err(error) = result {
                if !worker_status.cancelled() {
                    *worker_status
                        .error
                        .lock()
                        .unwrap_or_else(|p| p.into_inner()) = Some(error.clone());
                    let _ = ready_tx.try_send(Err(error));
                }
            }
            #[cfg(test)]
            worker_status.worker_finished.store(true, Ordering::Release);
        })
        .map_err(|_| audio_error(AudioErrorCode::InternalError, "无法启动流解码线程", true))?;
    loop {
        if cancelled() || status.cancelled() {
            status.cancel();
            return Err(audio_error(
                AudioErrorCode::Superseded,
                "流连接已取消",
                true,
            ));
        }
        if let Some(error) = status.preparation_error() {
            *status.error.lock().unwrap_or_else(|p| p.into_inner()) = Some(error.clone());
            status.cancel();
            return Err(error);
        }
        match ready_rx.recv_timeout(POLL) {
            Ok(Ok((channels, sample_rate))) => {
                return Ok((
                    Box::new(NetworkAudioSource {
                        status: status.clone(),
                        rx: pcm_rx,
                        current: Vec::new().into_iter(),
                        channels,
                        sample_rate,
                    }),
                    status,
                ))
            }
            Ok(Err(error)) => return Err(error),
            Err(mpsc::RecvTimeoutError::Timeout) => (),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(status.error().unwrap_or_else(|| {
                    audio_error(
                        AudioErrorCode::PlaybackFailed,
                        "流连接在准备完成前关闭",
                        true,
                    )
                }))
            }
        }
    }
}

fn decode_stream(
    url: &str,
    status: &Arc<StreamStatus>,
    ready: &SyncSender<Result<(u16, u32), AudioCommandError>>,
    pcm: &SyncSender<Vec<i16>>,
) -> Result<(), AudioCommandError> {
    let failure = |message: String| audio_error(AudioErrorCode::PlaybackFailed, message, true);
    let client = reqwest::blocking::Client::builder()
        // blocking timeout applies to each Read, rather than the live response lifetime.
        .timeout(IO_TIMEOUT)
        .connect_timeout(IO_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("too many redirects")
            } else if matches!(attempt.url().scheme(), "http" | "https")
                && attempt.url().username().is_empty()
                && attempt.url().password().is_none()
            {
                attempt.follow()
            } else {
                attempt.error("unsupported redirect address")
            }
        }))
        .user_agent("SpMusic/0.1")
        .build()
        .map_err(|_| failure("无法初始化网络流连接".into()))?;
    let response = client
        .get(url)
        .header("Icy-MetaData", "1")
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| {
            if error.is_timeout() {
                failure("网络流连接超时（5 秒）".into())
            } else if let Some(code) = error.status() {
                failure(format!("网络流服务器返回 HTTP {}", code.as_u16()))
            } else {
                failure("无法连接网络流，请检查地址与网络".into())
            }
        })?;
    if status.cancelled() {
        return Ok(());
    }
    let station_name = response
        .headers()
        .get("icy-name")
        .and_then(|header| std::str::from_utf8(header.as_bytes()).ok())
        .and_then(valid_station_name);
    *status
        .station_name
        .lock()
        .unwrap_or_else(|p| p.into_inner()) = station_name;
    if response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("mpegurl") || v.contains("vnd.apple"))
    {
        return Err(audio_error(
            AudioErrorCode::UnsupportedFormat,
            "暂不支持 HLS 流，请使用直接音频地址",
            true,
        ));
    }
    let interval = super::network_icy::metadata_interval(
        response.headers().get("icy-metaint").and_then(|value| value.to_str().ok()),
    );
    // ICY Content-Length includes metadata and is not an audio truncation target.
    let content_length = if interval.is_some() { None } else { response.content_length() };
    let hint = tauri::Url::parse(url)
        .ok()
        .map(|u| u.path().to_string())
        .unwrap_or_default();
    let http = HttpMediaSource { response, status: status.clone() };
    let media: Box<dyn MediaSource> = if interval.is_some() {
        Box::new(super::network_icy::IcyReader::new(http, interval, status.clone()))
    } else {
        Box::new(http)
    };
    let mut decoder = SymphoniaAudioSource::open_stream(Path::new(&hint), media)
    .map_err(|error| {
        tracing::warn!(operation = "audio.network.decoder_open", error = ?error, "network audio preparation failed");
        status.error().unwrap_or_else(|| {
            audio_error(
                AudioErrorCode::UnsupportedFormat,
                "流没有可解码的音频",
                true,
            )
        })
    })?;
    let input_channels = decoder.channels();
    if input_channels == 0
        || input_channels > 8
        || decoder.sample_rate() == 0
        || decoder.sample_rate() > 384_000
    {
        return Err(audio_error(
            AudioErrorCode::UnsupportedFormat,
            "流音频参数不受支持",
            true,
        ));
    }
    let channels = input_channels.min(2);
    let rate = decoder.sample_rate();
    let finite_container = decoder.total_duration().is_some();
    let expected_samples = decoder.expected_pcm_samples();
    let mut decoded_samples = 0u64;
    let mut chunk = Vec::with_capacity(CHUNK_SAMPLES);
    let mut announced = false;
    loop {
        if status.cancelled() {
            return Ok(());
        }
        let sample = decoder.next_checked();
        if decoder.channels() != input_channels || decoder.sample_rate() != rate {
            return Err(failure("流在播放中改变了声道数或采样率，请重新播放".into()));
        }
        match sample {
            Ok(Some(first)) => {
                if input_channels > 2 {
                    let mut frame = vec![first];
                    for _ in 1..input_channels {
                        frame.push(
                            decoder
                                .next_checked()
                                .map_err(|_| failure("流解码中断".into()))?
                                .ok_or_else(|| failure("流声道数据不完整".into()))?,
                        );
                    }
                    chunk.extend(super::source::downmix_frame_to_stereo(&frame));
                    decoded_samples += input_channels as u64;
                } else {
                    chunk.push(first);
                    decoded_samples += 1;
                }
            }
            Err(DecodeError::IoError(ref error))
                if error.kind() == io::ErrorKind::UnexpectedEof =>
            {
                return finish_stream(
                    status,
                    pcm,
                    ready,
                    chunk,
                    announced,
                    channels,
                    rate,
                    content_length,
                    finite_container,
                    expected_samples,
                    decoded_samples,
                );
            }
            Err(_) => {
                return Err(status
                    .error()
                    .unwrap_or_else(|| failure("网络流读取或解码中断，请重试".into())))
            }
            Ok(None) => {
                return finish_stream(
                    status,
                    pcm,
                    ready,
                    chunk,
                    announced,
                    channels,
                    rate,
                    content_length,
                    finite_container,
                    expected_samples,
                    decoded_samples,
                )
            }
        }
        if chunk.len() >= CHUNK_SAMPLES {
            send_chunk(
                pcm,
                std::mem::replace(&mut chunk, Vec::with_capacity(CHUNK_SAMPLES)),
                status,
            )?;
            if !announced {
                status.prepared.store(true, Ordering::Release);
                let _ = ready.send(Ok((channels, rate)));
                announced = true;
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn finish_stream(
    status: &StreamStatus,
    pcm: &SyncSender<Vec<i16>>,
    ready: &SyncSender<Result<(u16, u32), AudioCommandError>>,
    chunk: Vec<i16>,
    announced: bool,
    channels: u16,
    rate: u32,
    content_length: Option<u64>,
    finite_container: bool,
    expected_samples: Option<u64>,
    decoded_samples: u64,
) -> Result<(), AudioCommandError> {
    if let Some(error) = status.error() {
        return Err(error);
    }
    if expected_samples.is_some_and(|expected| decoded_samples < expected) {
        return Err(audio_error(
            AudioErrorCode::PlaybackFailed,
            "流音频数据不完整，连接已提前结束",
            true,
        ));
    }
    let read = status.bytes_read.load(Ordering::Acquire);
    // A finite container can finish its declared audio frames before the
    // HTTP body tail (tags/padding). Only transport errors, or an unexpected
    // EOF in an unbounded container, establish a broken connection here.
    if (!finite_container && content_length.is_some_and(|length| read < length))
        || (content_length.is_none() && !finite_container)
    {
        return Err(audio_error(
            AudioErrorCode::PlaybackFailed,
            "网络流连接意外结束",
            true,
        ));
    }
    if !announced && chunk.is_empty() {
        return Err(audio_error(
            AudioErrorCode::UnsupportedFormat,
            "流没有可解码的音频样本",
            true,
        ));
    }
    if !chunk.is_empty() {
        send_chunk(pcm, chunk, status)?;
    }
    if !announced {
        status.prepared.store(true, Ordering::Release);
        let _ = ready.send(Ok((channels, rate)));
    }
    Ok(())
}

fn send_chunk(
    tx: &SyncSender<Vec<i16>>,
    mut chunk: Vec<i16>,
    status: &StreamStatus,
) -> Result<(), AudioCommandError> {
    loop {
        if status.cancelled() {
            return Ok(());
        }
        match tx.try_send(chunk) {
            Ok(()) => return Ok(()),
            Err(TrySendError::Full(returned)) => {
                chunk = returned;
                thread::sleep(POLL);
            }
            Err(TrySendError::Disconnected(_)) => return Ok(()),
        }
    }
}

struct NetworkAudioSource {
    status: Arc<StreamStatus>,
    rx: Receiver<Vec<i16>>,
    current: std::vec::IntoIter<i16>,
    channels: u16,
    sample_rate: u32,
}
impl Drop for NetworkAudioSource {
    fn drop(&mut self) {
        self.status.cancel();
    }
}
impl Iterator for NetworkAudioSource {
    type Item = i16;
    fn next(&mut self) -> Option<i16> {
        if self.status.cancelled() {
            return None;
        }
        if let Some(value) = self.current.next() {
            return Some(value);
        }
        match self.rx.try_recv() {
            Ok(chunk) => {
                self.current = chunk.into_iter();
                self.current.next()
            }
            Err(TryRecvError::Empty) => Some(0), // underrun is silence, never EOF.
            Err(TryRecvError::Disconnected) => None,
        }
    }
}
impl Source for NetworkAudioSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }
    fn channels(&self) -> u16 {
        self.channels
    }
    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

#[cfg(test)]
#[path = "network_tests.rs"]
mod tests;
