use crate::{
    audio::{
        self,
        network::{canonical_url, display_name, is_stream, stream_id, valid_station_name},
        AudioFolderPlaylist,
    },
    library_folders::{replace_file, LibraryError},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddStreamInput {
    pub url: String,
    pub title: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoveStreamsInput {
    pub ids: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredStreams {
    version: u8,
    streams: Vec<StoredStream>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredStream {
    url: String,
    title: String,
    created_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    station_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title_origin: Option<TitleOrigin>,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum TitleOrigin {
    User,
    Playlist,
}

impl StoredStream {
    fn has_user_title(&self) -> bool {
        self.title != self.url && self.title_origin != Some(TitleOrigin::Playlist)
    }
}

pub struct LibraryStreamRegistry {
    path: PathBuf,
    lock: Mutex<()>,
}
impl LibraryStreamRegistry {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join("library-streams.v1.json"),
            lock: Mutex::new(()),
        }
    }
    pub fn get(&self) -> Result<AudioFolderPlaylist, LibraryError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        Ok(snapshot(self.read()?.streams))
    }
    pub fn add(&self, input: AddStreamInput) -> Result<AudioFolderPlaylist, LibraryError> {
        let url = canonical_url(&input.url).map_err(|e| LibraryError::invalid(e.message))?;
        let title = input.title.unwrap_or_default().trim().to_string();
        validate_title(&title, &url)?;
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let mut stored = self.read()?;
        if let Some(existing) = stored.streams.iter_mut().find(|s| s.url == url) {
            if !title.is_empty() {
                existing.title = title;
                existing.title_origin =
                    (existing.title != existing.url).then_some(TitleOrigin::User);
            }
        } else {
            stored.streams.push(StoredStream {
                station_name: None,
                title_origin: (!title.is_empty() && title != url).then_some(TitleOrigin::User),
                title: if title.is_empty() {
                    display_name(&url)
                } else {
                    title
                },
                url,
                created_at_ms: now_ms(),
            });
        }
        self.write(&stored)?;
        Ok(snapshot(stored.streams))
    }
    pub fn import(&self, playlist: &AudioFolderPlaylist) -> Result<(), LibraryError> {
        let imported: Vec<_> = playlist
            .tracks
            .iter()
            .filter(|t| is_stream(&t.source_path))
            .collect();
        if imported.is_empty() {
            return Ok(());
        }
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let mut stored = self.read()?;
        for track in imported {
            let url =
                canonical_url(&track.source_path).map_err(|e| LibraryError::invalid(e.message))?;
            let title = track.title.as_deref().unwrap_or_default().trim();
            validate_title(title, &url)?;
            if let Some(existing) = stored.streams.iter_mut().find(|s| s.url == url) {
                // A URL fallback is not a user-provided replacement name.
                if !title.is_empty() && title != url && !existing.has_user_title() {
                    existing.title = title.to_owned();
                    existing.title_origin = Some(TitleOrigin::Playlist);
                }
            } else {
                stored.streams.push(StoredStream {
                    station_name: None,
                    title_origin: (!title.is_empty() && title != url)
                        .then_some(TitleOrigin::Playlist),
                    title: if title.is_empty() {
                        display_name(&url)
                    } else {
                        title.to_owned()
                    },
                    url,
                    created_at_ms: now_ms(),
                });
            }
        }
        self.write(&stored)
    }

    /// Called only by the metadata worker after playback accepted a response.
    /// A removed member stays removed; discovery never inserts a new address.
    pub(crate) fn remember_station_name(
        &self,
        url: &str,
        discovered: Option<&str>,
    ) -> Result<Option<String>, LibraryError> {
        let url = canonical_url(url).map_err(|e| LibraryError::invalid(e.message))?;
        let discovered = discovered.and_then(valid_station_name);
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let mut stored = self.read()?;
        let Some(member) = stored.streams.iter_mut().find(|item| item.url == url) else {
            return Ok(None);
        };
        let mut changed = false;
        if let Some(discovered) = discovered {
            if member.station_name.as_ref() != Some(&discovered) {
                member.station_name = Some(discovered);
                changed = true;
            }
        }
        let result = member.station_name.clone();
        if changed {
            self.write(&stored)?;
        }
        Ok(result)
    }
    pub fn remove(&self, input: RemoveStreamsInput) -> Result<AudioFolderPlaylist, LibraryError> {
        if input.ids.is_empty() || input.ids.len() > 8192 {
            return Err(LibraryError::invalid("请选择 1 至 8192 个流"));
        }
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let mut stored = self.read()?;
        let ids: HashSet<_> = input.ids.into_iter().collect();
        stored.streams.retain(|s| !ids.contains(&stream_id(&s.url)));
        self.write(&stored)?;
        Ok(snapshot(stored.streams))
    }
    fn read(&self) -> Result<StoredStreams, LibraryError> {
        let text = match fs::read_to_string(&self.path) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(StoredStreams {
                    version: 1,
                    streams: vec![],
                })
            }
            Err(e) => return Err(LibraryError::storage(format!("读取流失败：{e}"))),
        };
        let stored: StoredStreams = serde_json::from_str(&text)
            .map_err(|e| LibraryError::storage(format!("流存储格式无效：{e}")))?;
        let mut seen = HashSet::new();
        if stored.version != 1
            || stored.streams.iter().any(|s| {
                canonical_url(&s.url).ok().as_deref() != Some(&s.url)
                    || !seen.insert(&s.url)
                    || s.title.trim().is_empty()
                    || validate_title(&s.title, &s.url).is_err()
                    || s.station_name.as_ref().is_some_and(|name| {
                        valid_station_name(name).as_deref() != Some(name.as_str())
                    })
                    || s.created_at_ms > 9_007_199_254_740_991
            })
        {
            return Err(LibraryError::storage("流存储版本或内容无效"));
        }
        Ok(stored)
    }
    fn write(&self, stored: &StoredStreams) -> Result<(), LibraryError> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| LibraryError::storage("流存储路径无效"))?;
        fs::create_dir_all(parent).map_err(|e| LibraryError::storage(e.to_string()))?;
        let temp = self.path.with_extension("json.tmp");
        let result = (|| {
            let mut file = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&temp)
                .map_err(|e| LibraryError::storage(e.to_string()))?;
            let bytes = serde_json::to_vec_pretty(stored)
                .map_err(|e| LibraryError::storage(e.to_string()))?;
            file.write_all(&bytes)
                .and_then(|()| file.sync_all())
                .map_err(|e| LibraryError::storage(e.to_string()))?;
            drop(file);
            replace_file(&temp, &self.path).map_err(|e| LibraryError::storage(e.to_string()))
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }
}
fn validate_title(title: &str, url: &str) -> Result<(), LibraryError> {
    let limit = if title == url { 8192 } else { 1024 };
    if title.len() > limit || title.chars().any(char::is_control) {
        Err(LibraryError::invalid("流名称无效或超过允许长度"))
    } else {
        Ok(())
    }
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(9_007_199_254_740_991) as u64
}
fn snapshot(streams: Vec<StoredStream>) -> AudioFolderPlaylist {
    AudioFolderPlaylist {
        source_kind: audio::AudioPlaylistSourceKind::Streams,
        source_path: "streams:library".into(),
        source_name: "流".into(),
        directory_name: "流".into(),
        directory_path: String::new(),
        directory_paths: None,
        selected_index: 0,
        tracks: streams
            .into_iter()
            .map(|s| {
                let mut descriptor =
                    audio::stream_descriptor(&s.url, Some(s.title.clone()), Some(s.created_at_ms));
                if s.title == s.url {
                    if let Some(name) = &s.station_name {
                        descriptor.file_name = name.clone();
                    }
                }
                descriptor.station_name = s.station_name;
                descriptor
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "spmusic-stream-registry-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }
    #[test]
    fn adds_without_network_preserve_url_case_identity_and_creation_time() {
        let root = test_dir();
        let registry = LibraryStreamRegistry::new(&root);
        let first = registry
            .add(AddStreamInput {
                url: "HTTP://127.0.0.1:1/Live?Token=AbC#ignored".into(),
                title: None,
            })
            .unwrap();
        assert_eq!(first.source_kind, audio::AudioPlaylistSourceKind::Streams);
        assert_eq!(
            first.tracks[0].source_path,
            "http://127.0.0.1:1/Live?Token=AbC"
        );
        assert_eq!(first.tracks[0].file_name, first.tracks[0].source_path);
        let created = first.tracks[0].created_at_ms;
        let updated = registry
            .add(AddStreamInput {
                url: first.tracks[0].source_path.clone(),
                title: Some("电台 A".into()),
            })
            .unwrap();
        assert_eq!(updated.tracks.len(), 1);
        assert_eq!(updated.tracks[0].file_name, "电台 A");
        assert_eq!(updated.tracks[0].created_at_ms, created);
        let second = registry
            .add(AddStreamInput {
                url: "http://127.0.0.1:1/live?Token=AbC".into(),
                title: None,
            })
            .unwrap();
        assert_eq!(second.tracks.len(), 2);
        assert_ne!(second.tracks[0].id, second.tracks[1].id);
        let restored = LibraryStreamRegistry::new(&root).get().unwrap();
        assert_eq!(restored.tracks.len(), 2);
        let removed = registry
            .remove(RemoveStreamsInput {
                ids: vec![first.tracks[0].id.clone()],
            })
            .unwrap();
        assert_eq!(removed.tracks.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn mixed_m3u_import_persists_titles_and_updates_stream_names_without_fetching() {
        let root = test_dir();
        let registry = LibraryStreamRegistry::new(&root);
        fs::write(root.join("local.wav"), []).unwrap();
        let path = root.join("mixed.m3u");
        fs::write(&path, "#EXTM3U\nlocal.wav\n#EXTINF:-1,First station\nhttp://127.0.0.1:1/Live?Token=A\nhttp://127.0.0.1:1/live?Token=A\nhttp://127.0.0.1:1/Live?Token=A\n").unwrap();
        let imported = audio::import_m3u8_playlist(&path).unwrap();
        assert_eq!(imported.tracks.len(), 3);
        registry.import(&imported).unwrap();
        let original = registry.get().unwrap();
        assert_eq!(original.tracks.len(), 2);
        assert_eq!(original.tracks[0].file_name, "First station");
        let playlists = crate::library_playlists::LibraryPlaylistRegistry::new(&root);
        playlists.upsert(&imported).unwrap();
        let restored = playlists.get().unwrap();
        assert_eq!(restored[0].tracks[1].file_name, "First station");
        assert_eq!(restored[0].tracks[1].id, original.tracks[0].id);
        fs::write(
            &path,
            "#EXTM3U\n#EXTINF:-1,Renamed station\nhttp://127.0.0.1:1/Live?Token=A\n",
        )
        .unwrap();
        let renamed = audio::import_m3u8_playlist(&path).unwrap();
        registry.import(&renamed).unwrap();
        let updated = registry.get().unwrap();
        assert_eq!(updated.tracks.len(), 2);
        assert_eq!(updated.tracks[0].file_name, "Renamed station");
        assert_eq!(
            updated.tracks[0].created_at_ms,
            original.tracks[0].created_at_ms
        );
        registry
            .remove(RemoveStreamsInput {
                ids: vec![updated.tracks[0].id.clone()],
            })
            .unwrap();
        assert_eq!(
            playlists.get().unwrap()[0].tracks.len(),
            3,
            "stream root removal cannot mutate a playlist snapshot"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn corrupt_or_future_registry_is_never_replaced_and_bad_input_never_writes() {
        let root = test_dir();
        let registry = LibraryStreamRegistry::new(&root);
        for bytes in ["not json", "{\"version\":2,\"streams\":[]}"] {
            fs::write(&registry.path, bytes).unwrap();
            assert!(registry.get().is_err());
            assert!(registry
                .add(AddStreamInput {
                    url: "https://example.invalid/live".into(),
                    title: None
                })
                .is_err());
            assert_eq!(fs::read_to_string(&registry.path).unwrap(), bytes);
        }
        fs::remove_file(&registry.path).unwrap();
        for url in [
            "file:///audio.wav",
            "rtsp://example.invalid/live",
            "https://user:secret@example.invalid/live",
            "https://example.invalid/\\bad",
        ] {
            assert!(registry
                .add(AddStreamInput {
                    url: url.into(),
                    title: None
                })
                .is_err());
        }
        assert!(!registry.path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn long_signed_url_fallback_roundtrips_add_reload_and_import_but_custom_title_stays_bounded() {
        let root = test_dir();
        let registry = LibraryStreamRegistry::new(&root);
        let url = format!("https://example.invalid/Live?Token={}", "A".repeat(2048));
        let added = registry
            .add(AddStreamInput {
                url: url.clone(),
                title: None,
            })
            .unwrap();
        assert_eq!(added.tracks[0].file_name, url);
        let restored = LibraryStreamRegistry::new(&root).get().unwrap();
        assert_eq!(restored.tracks[0].file_name, url);
        let path = root.join("long.m3u");
        fs::write(&path, format!("#EXTM3U\n{url}\n{url}&Second=1\n")).unwrap();
        let playlist = audio::import_m3u8_playlist(&path).unwrap();
        registry.import(&playlist).unwrap();
        let imported = LibraryStreamRegistry::new(&root).get().unwrap();
        assert_eq!(imported.tracks.len(), 2);
        assert_eq!(imported.tracks[1].file_name, format!("{url}&Second=1"));
        assert_eq!(
            imported.tracks[0].created_at_ms,
            added.tracks[0].created_at_ms
        );
        let accepted_bytes = fs::read(&registry.path).unwrap();
        assert!(registry
            .add(AddStreamInput {
                url,
                title: Some("X".repeat(1025))
            })
            .is_err());
        assert_eq!(fs::read(&registry.path).unwrap(), accepted_bytes);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn station_name_is_cached_offline_but_never_overrides_explicit_user_or_playlist_title() {
        let root = test_dir();
        let registry = LibraryStreamRegistry::new(&root);
        let url = "https://example.invalid/radio";
        registry
            .add(AddStreamInput {
                url: url.into(),
                title: None,
            })
            .unwrap();
        assert_eq!(
            registry
                .remember_station_name(url, Some("  Station A  "))
                .unwrap()
                .as_deref(),
            Some("Station A")
        );
        let snapshot = LibraryStreamRegistry::new(&root).get().unwrap();
        assert_eq!(snapshot.tracks[0].title.as_deref(), Some(url));
        assert_eq!(snapshot.tracks[0].file_name, "Station A");
        assert_eq!(
            snapshot.tracks[0].station_name.as_deref(),
            Some("Station A")
        );
        let saved = fs::read(&registry.path).unwrap();
        registry
            .remember_station_name(url, Some("Station A"))
            .unwrap();
        registry
            .remember_station_name(url, Some("bad\tname"))
            .unwrap();
        registry.remember_station_name(url, None).unwrap();
        assert_eq!(
            fs::read(&registry.path).unwrap(),
            saved,
            "missing/invalid/unchanged names preserve the snapshot"
        );
        let mut playlist = snapshot.clone();
        playlist.tracks[0].title = Some("Imported title".into());
        registry.import(&playlist).unwrap();
        assert_eq!(
            registry.get().unwrap().tracks[0].file_name,
            "Imported title"
        );
        registry
            .add(AddStreamInput {
                url: url.into(),
                title: Some("My title".into()),
            })
            .unwrap();
        playlist.tracks[0].title = Some("Later imported title".into());
        registry.import(&playlist).unwrap();
        registry
            .remember_station_name(url, Some("Station B"))
            .unwrap();
        let restored = LibraryStreamRegistry::new(&root).get().unwrap();
        assert_eq!(restored.tracks[0].file_name, "My title");
        assert_eq!(
            restored.tracks[0].station_name.as_deref(),
            Some("Station B")
        );
        registry
            .remove(RemoveStreamsInput {
                ids: vec![restored.tracks[0].id.clone()],
            })
            .unwrap();
        assert_eq!(
            registry
                .remember_station_name(url, Some("Late station"))
                .unwrap(),
            None
        );
        assert!(
            registry.get().unwrap().tracks.is_empty(),
            "discovery cannot resurrect deleted members"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_explicit_titles_are_user_owned_and_corrupt_cache_is_not_overwritten() {
        let root = test_dir();
        let registry = LibraryStreamRegistry::new(&root);
        let url = "https://example.invalid/radio";
        fs::write(&registry.path, format!(r#"{{"version":1,"streams":[{{"url":"{url}","title":"Legacy title","createdAtMs":1}}]}}"#)).unwrap();
        let mut playlist = registry.get().unwrap();
        playlist.tracks[0].title = Some("Imported title".into());
        registry.import(&playlist).unwrap();
        registry
            .remember_station_name(url, Some("Station A"))
            .unwrap();
        assert_eq!(registry.get().unwrap().tracks[0].file_name, "Legacy title");
        let corrupt = r#"{"version":1,"streams":[{"url":"https://example.invalid/radio","title":"Title","createdAtMs":1,"stationName":"bad\tname"}]}"#;
        fs::write(&registry.path, corrupt).unwrap();
        assert!(registry
            .remember_station_name(url, Some("Station A"))
            .is_err());
        assert_eq!(fs::read_to_string(&registry.path).unwrap(), corrupt);
        fs::remove_dir_all(root).unwrap();
    }
}
