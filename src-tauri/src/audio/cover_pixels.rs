use std::{
    fs::{self, File},
    future::Future,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
};

use image::{
    imageops::FilterType, metadata::Orientation, DynamicImage, GenericImageView, ImageDecoder,
    ImageError, ImageReader, Limits,
};
use serde::{Deserialize, Serialize};

const COVER_DIRECTORY: &str = "covers";
const AUDIO_CACHE_DIRECTORY: &str = "audio";
const MAX_INPUT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_SOURCE_EDGE: u32 = 16_384;
const MAX_SOURCE_PIXELS: u64 = 64 * 1024 * 1024;
const MAX_DECODE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_OUTPUT_BYTES: u64 = 3072 * 3072 * 4;

const HEADER_MAGIC: [u8; 4] = *b"SPXR";
const HEADER_VERSION: u16 = 1;
const HEADER_LEN: u16 = 40;
const PIXEL_FORMAT_RGBA8_UNPREMULTIPLIED: u32 = 1;
const FLAG_ORIENTATION_APPLIED: u32 = 1 << 0;
const FLAG_RESIZED: u32 = 1 << 1;

const ALLOWED_MAX_EDGES: [u32; 7] = [256, 512, 768, 1024, 1536, 2048, 3072];

static REQUEST_COORDINATOR: OnceLock<CoverRequestCoordinator> = OnceLock::new();

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLoadCoverPixelsInput {
    pub file_path: String,
    pub max_edge: u32,
    pub request_id: u64,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CoverPixelsErrorCode {
    InvalidMaxEdge,
    InvalidPath,
    FileTooLarge,
    InvalidImage,
    ImageTooLarge,
    AllocationFailed,
    WorkerFailed,
    InvalidRequestId,
    StaleRequest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverPixelsError {
    pub code: CoverPixelsErrorCode,
    pub message: String,
    pub recoverable: bool,
}

impl CoverPixelsError {
    fn recoverable(code: CoverPixelsErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            recoverable: true,
        }
    }

    fn internal(code: CoverPixelsErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            recoverable: false,
        }
    }

    fn stale() -> Self {
        Self::recoverable(
            CoverPixelsErrorCode::StaleRequest,
            "a newer cover pixel request superseded this request",
        )
    }
}

struct CoverRequestCoordinator {
    latest_request_id: AtomicU64,
    decode_gate: tauri::async_runtime::Mutex<()>,
}

impl CoverRequestCoordinator {
    fn new() -> Self {
        Self {
            latest_request_id: AtomicU64::new(0),
            decode_gate: tauri::async_runtime::Mutex::new(()),
        }
    }

    fn register(&self, request_id: u64) -> Result<(), CoverPixelsError> {
        if request_id == 0 {
            return Err(CoverPixelsError::recoverable(
                CoverPixelsErrorCode::InvalidRequestId,
                "requestId must be a positive monotonically increasing integer",
            ));
        }

        let mut latest = self.latest_request_id.load(Ordering::Acquire);
        loop {
            if request_id <= latest {
                return Err(CoverPixelsError::stale());
            }
            match self.latest_request_id.compare_exchange_weak(
                latest,
                request_id,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Ok(()),
                Err(observed) => latest = observed,
            }
        }
    }

    async fn run_registered<T, F, Fut>(
        &self,
        request_id: u64,
        work: F,
    ) -> Result<T, CoverPixelsError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, CoverPixelsError>>,
    {
        let _guard = self.decode_gate.lock().await;
        if self.latest_request_id.load(Ordering::Acquire) != request_id {
            return Err(CoverPixelsError::stale());
        }
        work().await
    }

    async fn run_latest<T, F, Fut>(&self, request_id: u64, work: F) -> Result<T, CoverPixelsError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, CoverPixelsError>>,
    {
        self.register(request_id)?;
        self.run_registered(request_id, work).await
    }
}

pub async fn load_cover_pixels(
    app_cache_dir: PathBuf,
    input: AudioLoadCoverPixelsInput,
) -> Result<Vec<u8>, CoverPixelsError> {
    validate_max_edge(input.max_edge)?;

    // Register before queueing, then re-check after acquiring the gate. Rapid track
    // changes therefore keep at most the current decode plus the newest waiting decode;
    // superseded futures return STALE_REQUEST without entering the blocking pool.
    let coordinator = REQUEST_COORDINATOR.get_or_init(CoverRequestCoordinator::new);
    let request_id = input.request_id;
    coordinator
        .run_latest(request_id, || async move {
            tauri::async_runtime::spawn_blocking(move || {
                load_cover_pixels_blocking(&app_cache_dir, &input.file_path, input.max_edge)
            })
            .await
            .map_err(|error| {
                tracing::error!(
                    operation = "audio.cover_pixels.join",
                    request_id,
                    error = %error,
                    "cover pixel decoder worker failed",
                );
                CoverPixelsError::internal(
                    CoverPixelsErrorCode::WorkerFailed,
                    "cover pixel decoder worker failed",
                )
            })?
        })
        .await
}

fn load_cover_pixels_blocking(
    app_cache_dir: &Path,
    requested_path: &str,
    max_edge: u32,
) -> Result<Vec<u8>, CoverPixelsError> {
    let covers_root = app_cache_dir
        .join(AUDIO_CACHE_DIRECTORY)
        .join(COVER_DIRECTORY);
    let path = validate_cover_path(&covers_root, Path::new(requested_path))?;
    let bytes = read_bounded_file(&path)?;
    decode_and_pack(&bytes, max_edge)
}

fn validate_max_edge(max_edge: u32) -> Result<(), CoverPixelsError> {
    if ALLOWED_MAX_EDGES.contains(&max_edge) {
        Ok(())
    } else {
        Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidMaxEdge,
            format!(
                "maxEdge must be one of {}",
                ALLOWED_MAX_EDGES
                    .iter()
                    .map(u32::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        ))
    }
}

fn validate_cover_path(
    covers_root: &Path,
    requested_path: &Path,
) -> Result<PathBuf, CoverPixelsError> {
    if requested_path.as_os_str().is_empty() {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover file path is empty",
        ));
    }

    let canonical_root = fs::canonicalize(covers_root).map_err(|error| {
        tracing::warn!(
            operation = "audio.cover_pixels.validate_root",
            path = %covers_root.display(),
            error = %error,
            "cover cache directory is unavailable",
        );
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover cache directory is unavailable",
        )
    })?;

    let link_metadata = fs::symlink_metadata(requested_path).map_err(|error| {
        tracing::warn!(
            operation = "audio.cover_pixels.validate_path",
            path = %requested_path.display(),
            error = %error,
            "cover cache file is unavailable",
        );
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover cache file is unavailable",
        )
    })?;

    if link_metadata.file_type().is_symlink() {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover cache path must not be a symbolic link",
        ));
    }

    let canonical_path = fs::canonicalize(requested_path).map_err(|error| {
        tracing::warn!(
            operation = "audio.cover_pixels.canonicalize_path",
            path = %requested_path.display(),
            error = %error,
            "cover cache file path cannot be resolved",
        );
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover cache file path cannot be resolved",
        )
    })?;

    if !canonical_path.starts_with(&canonical_root) || !link_metadata.file_type().is_file() {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover path is not a regular file in the audio cover cache",
        ));
    }

    Ok(canonical_path)
}

fn read_bounded_file(path: &Path) -> Result<Vec<u8>, CoverPixelsError> {
    let file = File::open(path).map_err(|error| {
        tracing::warn!(
            operation = "audio.cover_pixels.open",
            path = %path.display(),
            error = %error,
            "failed to open cover cache file",
        );
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover cache file cannot be opened",
        )
    })?;

    let metadata = file.metadata().map_err(|error| {
        tracing::warn!(
            operation = "audio.cover_pixels.metadata",
            path = %path.display(),
            error = %error,
            "failed to read cover cache file metadata",
        );
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover cache file metadata is unavailable",
        )
    })?;

    if !metadata.is_file() {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidPath,
            "cover cache path is not a regular file",
        ));
    }
    if metadata.len() == 0 || metadata.len() > MAX_INPUT_BYTES {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::FileTooLarge,
            format!("cover file must contain 1 to {MAX_INPUT_BYTES} bytes"),
        ));
    }

    let initial_capacity = usize::try_from(metadata.len()).map_err(|_| {
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::FileTooLarge,
            "cover file size is not supported on this platform",
        )
    })?;
    let mut bytes = Vec::new();
    bytes.try_reserve_exact(initial_capacity).map_err(|_| {
        CoverPixelsError::internal(
            CoverPixelsErrorCode::AllocationFailed,
            "not enough memory to read cover file",
        )
    })?;

    file.take(MAX_INPUT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            tracing::warn!(
                operation = "audio.cover_pixels.read",
                path = %path.display(),
                error = %error,
                "failed to read cover cache file",
            );
            CoverPixelsError::recoverable(
                CoverPixelsErrorCode::InvalidPath,
                "cover cache file cannot be read",
            )
        })?;

    if bytes.is_empty() || u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_INPUT_BYTES {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::FileTooLarge,
            format!("cover file must contain 1 to {MAX_INPUT_BYTES} bytes"),
        ));
    }

    Ok(bytes)
}

fn decode_and_pack(bytes: &[u8], max_edge: u32) -> Result<Vec<u8>, CoverPixelsError> {
    validate_max_edge(max_edge)?;

    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(invalid_image)?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SOURCE_EDGE);
    limits.max_image_height = Some(MAX_SOURCE_EDGE);
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);

    let mut decoder = reader.into_decoder().map_err(invalid_image)?;
    let (encoded_width, encoded_height) = decoder.dimensions();
    let decoded_bytes = decoder.total_bytes();
    validate_source_dimensions(encoded_width, encoded_height, decoded_bytes)?;

    // Account for the decoder's output buffer before granting its internal allocation
    // budget. `max_alloc` is best-effort in image, while the dimension and byte checks
    // above are enforced independently by this command.
    let mut remaining_limits = Limits::default();
    remaining_limits.max_image_width = Some(MAX_SOURCE_EDGE);
    remaining_limits.max_image_height = Some(MAX_SOURCE_EDGE);
    remaining_limits.max_alloc = Some(MAX_DECODE_BYTES);
    remaining_limits
        .reserve(decoded_bytes)
        .map_err(image_too_large)?;
    decoder
        .set_limits(remaining_limits)
        .map_err(image_too_large)?;

    let orientation = decoder.orientation().map_err(invalid_image)?;
    let orientation_applied = orientation != Orientation::NoTransforms;
    let mut image = DynamicImage::from_decoder(decoder).map_err(invalid_image)?;
    image.apply_orientation(orientation);

    let (source_width, source_height) = image.dimensions();
    validate_source_dimensions(source_width, source_height, image.as_bytes().len() as u64)?;
    let (width, height) = scaled_dimensions(source_width, source_height, max_edge)?;
    let resized = (width, height) != (source_width, source_height);

    if resized {
        image = image.resize_exact(width, height, FilterType::Lanczos3);
    }

    // `image` exposes ICC bytes but does not apply arbitrary embedded ICC profiles
    // during DynamicImage decoding. The protocol therefore deliberately describes
    // channel layout only and does not claim the returned values were converted to sRGB.
    let pixels = image.into_rgba8().into_raw();
    pack_rgba(
        pixels,
        width,
        height,
        source_width,
        source_height,
        orientation_applied,
        resized,
    )
}

fn validate_source_dimensions(
    width: u32,
    height: u32,
    decoded_bytes: u64,
) -> Result<(), CoverPixelsError> {
    let pixels = u64::from(width).checked_mul(u64::from(height));
    if width == 0
        || height == 0
        || width > MAX_SOURCE_EDGE
        || height > MAX_SOURCE_EDGE
        || pixels.is_none_or(|pixels| pixels > MAX_SOURCE_PIXELS)
        || decoded_bytes > MAX_DECODE_BYTES
    {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::ImageTooLarge,
            "cover image dimensions or decoded size exceed the safety limit",
        ));
    }
    Ok(())
}

fn scaled_dimensions(
    width: u32,
    height: u32,
    max_edge: u32,
) -> Result<(u32, u32), CoverPixelsError> {
    validate_max_edge(max_edge)?;
    if width == 0 || height == 0 {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::InvalidImage,
            "cover image has invalid dimensions",
        ));
    }

    if width.max(height) <= max_edge {
        return Ok((width, height));
    }

    let (scaled_width, scaled_height) = if width >= height {
        let scaled_height =
            (u64::from(height) * u64::from(max_edge) + u64::from(width) / 2) / u64::from(width);
        (u64::from(max_edge), scaled_height.max(1))
    } else {
        let scaled_width =
            (u64::from(width) * u64::from(max_edge) + u64::from(height) / 2) / u64::from(height);
        (scaled_width.max(1), u64::from(max_edge))
    };

    let scaled_width = u32::try_from(scaled_width).map_err(|_| {
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::ImageTooLarge,
            "scaled cover width exceeds the supported range",
        )
    })?;
    let scaled_height = u32::try_from(scaled_height).map_err(|_| {
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::ImageTooLarge,
            "scaled cover height exceeds the supported range",
        )
    })?;
    Ok((scaled_width, scaled_height))
}

#[allow(clippy::too_many_arguments)]
fn pack_rgba(
    pixels: Vec<u8>,
    width: u32,
    height: u32,
    source_width: u32,
    source_height: u32,
    orientation_applied: bool,
    resized: bool,
) -> Result<Vec<u8>, CoverPixelsError> {
    let stride = width.checked_mul(4).ok_or_else(|| {
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::ImageTooLarge,
            "cover pixel stride exceeds the supported range",
        )
    })?;
    let expected_len = u64::from(stride)
        .checked_mul(u64::from(height))
        .ok_or_else(|| {
            CoverPixelsError::recoverable(
                CoverPixelsErrorCode::ImageTooLarge,
                "cover pixel length exceeds the supported range",
            )
        })?;

    if expected_len > MAX_OUTPUT_BYTES || expected_len != pixels.len() as u64 {
        return Err(CoverPixelsError::recoverable(
            CoverPixelsErrorCode::ImageTooLarge,
            "cover pixel buffer length is invalid or exceeds the safety limit",
        ));
    }
    let pixel_len = u32::try_from(expected_len).map_err(|_| {
        CoverPixelsError::recoverable(
            CoverPixelsErrorCode::ImageTooLarge,
            "cover pixel buffer length exceeds the protocol range",
        )
    })?;

    let mut output = Vec::new();
    output
        .try_reserve_exact(usize::from(HEADER_LEN) + pixels.len())
        .map_err(|_| {
            CoverPixelsError::internal(
                CoverPixelsErrorCode::AllocationFailed,
                "not enough memory to build cover pixel response",
            )
        })?;

    let mut flags = 0;
    if orientation_applied {
        flags |= FLAG_ORIENTATION_APPLIED;
    }
    if resized {
        flags |= FLAG_RESIZED;
    }

    output.extend_from_slice(&HEADER_MAGIC);
    output.extend_from_slice(&HEADER_VERSION.to_le_bytes());
    output.extend_from_slice(&HEADER_LEN.to_le_bytes());
    output.extend_from_slice(&width.to_le_bytes());
    output.extend_from_slice(&height.to_le_bytes());
    output.extend_from_slice(&stride.to_le_bytes());
    output.extend_from_slice(&PIXEL_FORMAT_RGBA8_UNPREMULTIPLIED.to_le_bytes());
    output.extend_from_slice(&pixel_len.to_le_bytes());
    output.extend_from_slice(&flags.to_le_bytes());
    output.extend_from_slice(&source_width.to_le_bytes());
    output.extend_from_slice(&source_height.to_le_bytes());
    output.extend_from_slice(&pixels);
    Ok(output)
}

fn invalid_image(error: impl std::fmt::Display) -> CoverPixelsError {
    tracing::warn!(
        operation = "audio.cover_pixels.decode",
        error = %error,
        "cover image could not be decoded",
    );
    CoverPixelsError::recoverable(
        CoverPixelsErrorCode::InvalidImage,
        "cover image format or data is invalid",
    )
}

fn image_too_large(error: ImageError) -> CoverPixelsError {
    tracing::warn!(
        operation = "audio.cover_pixels.limit",
        error = %error,
        "cover image exceeded decoder safety limits",
    );
    CoverPixelsError::recoverable(
        CoverPixelsErrorCode::ImageTooLarge,
        "cover image dimensions or decoded size exceed the safety limit",
    )
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::Cursor,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicU64, AtomicUsize, Ordering},
            Arc,
        },
    };

    use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};

    use super::*;

    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "spmusic-cover-pixels-{}-{}",
                std::process::id(),
                sequence
            ));
            fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let image = RgbaImage::from_pixel(width, height, Rgba([12, 34, 56, 255]));
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut bytes, ImageFormat::Png)
            .expect("encode fixture");
        bytes.into_inner()
    }

    fn jpeg_with_orientation(width: u32, height: u32, exif_orientation: u8) -> Vec<u8> {
        let image = RgbaImage::from_pixel(width, height, Rgba([12, 34, 56, 255]));
        let mut encoded = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut encoded, ImageFormat::Jpeg)
            .expect("encode fixture");
        let encoded = encoded.into_inner();
        assert_eq!(&encoded[0..2], &[0xff, 0xd8]);

        // Minimal little-endian TIFF IFD containing EXIF Orientation (0x0112).
        let mut app1_payload = Vec::from(&b"Exif\0\0"[..]);
        app1_payload.extend_from_slice(b"II");
        app1_payload.extend_from_slice(&42_u16.to_le_bytes());
        app1_payload.extend_from_slice(&8_u32.to_le_bytes());
        app1_payload.extend_from_slice(&1_u16.to_le_bytes());
        app1_payload.extend_from_slice(&0x0112_u16.to_le_bytes());
        app1_payload.extend_from_slice(&3_u16.to_le_bytes());
        app1_payload.extend_from_slice(&1_u32.to_le_bytes());
        app1_payload.extend_from_slice(&[exif_orientation, 0, 0, 0]);
        app1_payload.extend_from_slice(&0_u32.to_le_bytes());

        let segment_len = u16::try_from(app1_payload.len() + 2).expect("APP1 segment length");
        let mut result = Vec::with_capacity(encoded.len() + app1_payload.len() + 4);
        result.extend_from_slice(&encoded[0..2]);
        result.extend_from_slice(&[0xff, 0xe1]);
        result.extend_from_slice(&segment_len.to_be_bytes());
        result.extend_from_slice(&app1_payload);
        result.extend_from_slice(&encoded[2..]);
        result
    }

    fn u16_at(bytes: &[u8], offset: usize) -> u16 {
        u16::from_le_bytes(bytes[offset..offset + 2].try_into().expect("u16 field"))
    }

    fn u32_at(bytes: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("u32 field"))
    }

    #[test]
    fn protocol_header_is_fixed_and_self_consistent() {
        let response = decode_and_pack(&png_bytes(2, 3), 256).expect("decode fixture");

        assert_eq!(&response[0..4], b"SPXR");
        assert_eq!(u16_at(&response, 4), 1);
        assert_eq!(u16_at(&response, 6), 40);
        assert_eq!(u32_at(&response, 8), 2);
        assert_eq!(u32_at(&response, 12), 3);
        assert_eq!(u32_at(&response, 16), 8);
        assert_eq!(u32_at(&response, 20), 1);
        assert_eq!(u32_at(&response, 24), 24);
        assert_eq!(u32_at(&response, 28), 0);
        assert_eq!(u32_at(&response, 32), 2);
        assert_eq!(u32_at(&response, 36), 3);
        assert_eq!(response.len(), 40 + 24);
        assert_eq!(&response[40..44], &[12, 34, 56, 255]);
    }

    #[test]
    fn scaling_preserves_aspect_ratio_and_never_upsamples() {
        assert_eq!(scaled_dimensions(4000, 2000, 1024).unwrap(), (1024, 512));
        assert_eq!(scaled_dimensions(2000, 4000, 1024).unwrap(), (512, 1024));
        assert_eq!(scaled_dimensions(320, 200, 1024).unwrap(), (320, 200));
        assert_eq!(scaled_dimensions(1, 16_384, 256).unwrap(), (1, 256));
    }

    #[test]
    fn resize_sets_dimensions_and_resized_flag() {
        let response = decode_and_pack(&png_bytes(400, 200), 256).expect("decode fixture");

        assert_eq!(u32_at(&response, 8), 256);
        assert_eq!(u32_at(&response, 12), 128);
        assert_eq!(u32_at(&response, 28), FLAG_RESIZED);
        assert_eq!(u32_at(&response, 32), 400);
        assert_eq!(u32_at(&response, 36), 200);
    }

    #[test]
    fn exif_orientation_is_applied_before_scaling_and_packing() {
        let response =
            decode_and_pack(&jpeg_with_orientation(2, 1, 6), 256).expect("decode oriented fixture");

        assert_eq!(u32_at(&response, 8), 1);
        assert_eq!(u32_at(&response, 12), 2);
        assert_eq!(u32_at(&response, 28), FLAG_ORIENTATION_APPLIED);
        assert_eq!(u32_at(&response, 32), 1);
        assert_eq!(u32_at(&response, 36), 2);
    }

    #[test]
    fn path_validation_accepts_only_regular_files_below_canonical_root() {
        let test_dir = TestDirectory::new();
        let root = test_dir.path().join("audio").join("covers");
        fs::create_dir_all(&root).unwrap();
        let inside = root.join("cover.png");
        let outside = test_dir.path().join("outside.png");
        fs::write(&inside, png_bytes(1, 1)).unwrap();
        fs::write(&outside, png_bytes(1, 1)).unwrap();

        assert_eq!(
            validate_cover_path(&root, &inside).unwrap(),
            fs::canonicalize(&inside).unwrap()
        );
        assert!(validate_cover_path(&root, &outside).is_err());
        assert!(validate_cover_path(&root, &root).is_err());
    }

    #[test]
    fn invalid_image_is_rejected_without_panicking() {
        let error = decode_and_pack(b"not an image", 256).unwrap_err();
        assert!(matches!(error.code, CoverPixelsErrorCode::InvalidImage));
    }

    #[test]
    fn max_edge_is_discrete_and_bounded() {
        assert!(validate_max_edge(256).is_ok());
        assert!(validate_max_edge(3072).is_ok());
        assert!(validate_max_edge(255).is_err());
        assert!(validate_max_edge(3000).is_err());
        assert!(validate_max_edge(3073).is_err());
    }

    #[test]
    fn stale_queued_request_does_not_enter_decode_work() {
        tauri::async_runtime::block_on(async {
            let coordinator = Arc::new(CoverRequestCoordinator::new());
            let entered_decode = Arc::new(AtomicUsize::new(0));

            coordinator.register(1).expect("register old request");
            let held_gate = coordinator.decode_gate.lock().await;
            let stale_coordinator = Arc::clone(&coordinator);
            let stale_counter = Arc::clone(&entered_decode);
            let stale_task = tauri::async_runtime::spawn(async move {
                stale_coordinator
                    .run_registered(1, || async move {
                        stale_counter.fetch_add(1, Ordering::AcqRel);
                        Ok::<(), CoverPixelsError>(())
                    })
                    .await
            });

            coordinator.register(2).expect("register latest request");
            drop(held_gate);

            let stale_error = stale_task
                .await
                .expect("join stale request")
                .expect_err("old request must be stale");
            assert!(matches!(
                stale_error.code,
                CoverPixelsErrorCode::StaleRequest
            ));
            assert_eq!(entered_decode.load(Ordering::Acquire), 0);

            let latest_counter = Arc::clone(&entered_decode);
            coordinator
                .run_registered(2, || async move {
                    latest_counter.fetch_add(1, Ordering::AcqRel);
                    Ok::<(), CoverPixelsError>(())
                })
                .await
                .expect("latest request enters decode work");
            assert_eq!(entered_decode.load(Ordering::Acquire), 1);
        });
    }
}
