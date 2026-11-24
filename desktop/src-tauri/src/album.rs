use crate::store::Result;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

pub const MOMENTS: [&str; 16] = [
    "stump", "back", "leap", "pet", "chew", "nap", "sniff", "stand", "groom", "loaf", "sploot",
    "stretch", "flop", "nudge", "alert", "tilt",
];
pub const NOTES: [&str; 23] = [
    "stump", "back", "leap", "pet", "chew", "nap", "sniff", "stand", "groom", "loaf", "sploot",
    "stretch", "flop", "nudge", "alert", "tilt", "peek", "rest", "hop", "tunnel", "listen",
    "quiet", "scenery",
];
pub const SCENES: [&str; 3] = ["paper", "snow", "desktop"];
pub const LIGHTS: [&str; 3] = ["day", "dusk", "night"];

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    pub id: String,
    pub captured: i64,
    pub offset: i32,
    pub scene: String,
    pub light: String,
    pub pose: String,
    pub title: String,
    pub revision: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AlbumPage {
    pub rabbit_name: String,
    pub photos: Vec<Photo>,
    pub next: Option<String>,
    pub covers: BTreeMap<String, String>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct Uploaded {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UploadMeta {
    pub id: String,
    pub captured: i64,
    pub offset: i32,
    pub scene: String,
    pub light: String,
    pub pose: String,
    pub title: String,
}

#[derive(Default, Clone, Serialize, Deserialize)]
struct AlbumDisk {
    photos: Vec<Photo>,
}

pub fn checked_id(raw: &str) -> Result<String> {
    match Uuid::parse_str(raw) {
        Ok(id) if id.to_string() == raw => Ok(raw.to_owned()),
        _ => Err("照片编号无效".into()),
    }
}

pub fn checked_title(raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if trimmed.encode_utf16().count() > 40 {
        return Err("标题过长".into());
    }
    if trimmed
        .chars()
        .any(|c| c <= '\u{1f}' || matches!(c, '\u{7f}' | '\u{2028}' | '\u{2029}'))
    {
        return Err("标题请写在一行内".into());
    }
    Ok(trimmed.to_owned())
}

pub fn checked_moment(raw: &str) -> Result<&str> {
    MOMENTS
        .iter()
        .copied()
        .find(|m| *m == raw)
        .ok_or_else(|| "没有这一页瞬间".into())
}

pub fn parse_cursor(raw: &str) -> Result<(i64, String)> {
    let mut parts = raw.split('.');
    let (Some(time_raw), Some(id_raw), None) = (parts.next(), parts.next(), parts.next()) else {
        return Err("翻页位置无效".into());
    };
    if !(1..=13).contains(&time_raw.len()) || !time_raw.bytes().all(|b| b.is_ascii_digit()) {
        return Err("翻页位置无效".into());
    }
    let time: i64 = time_raw.parse().map_err(|_| "翻页位置无效")?;
    let id = checked_id(id_raw)?;
    Ok((time, id))
}

pub fn validate_upload_meta(meta: &UploadMeta) -> Result<String> {
    checked_id(&meta.id)?;
    if !SCENES.contains(&meta.scene.as_str())
        || !LIGHTS.contains(&meta.light.as_str())
        || !NOTES.contains(&meta.pose.as_str())
        || meta.offset.abs() > 840
        || !(1..=8_640_000_000_000).contains(&meta.captured)
        || (meta.pose == "stump" && meta.scene != "snow")
        || (meta.pose == "nap" && (meta.scene != "snow" || meta.light != "night"))
    {
        return Err("照片的拍摄记录不完整".into());
    }
    checked_title(&meta.title)
}

fn validate_png(
    bytes: &[u8],
    expected_w: u32,
    expected_h: u32,
    min_len: usize,
    max_len: usize,
    size_error: &str,
) -> Result<()> {
    if bytes.len() < min_len
        || bytes.len() > max_len
        || bytes.len() < 33
        || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
    {
        return Err(size_error.into());
    }
    let ihdr_len = u32::from_be_bytes(bytes[8..12].try_into().unwrap());
    if ihdr_len != 13 || &bytes[12..16] != b"IHDR" {
        return Err(size_error.into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width != expected_w || height != expected_h {
        return Err(size_error.into());
    }
    let mut at = 8usize;
    let mut has_idat = false;
    let mut ended = false;
    while at + 12 <= bytes.len() {
        let len = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        let kind = &bytes[at + 4..at + 8];
        if len > bytes.len() - at - 12 || kind == b"acTL" {
            return Err("这张原片不完整，请重新拍一张".into());
        }
        at += len + 12;
        if kind == b"IDAT" && len > 0 {
            has_idat = true;
        }
        if kind == b"IEND" {
            ended = len == 0 && at == bytes.len();
            break;
        }
    }
    if !has_idat || !ended {
        return Err("这张原片不完整，请重新拍一张".into());
    }
    Ok(())
}

pub fn decode_base64(raw: &str, max_bytes: usize) -> Result<Vec<u8>> {
    let bytes = raw.as_bytes();
    if bytes.is_empty() || bytes.len() % 4 != 0 || (bytes.len() / 4) * 3 > max_bytes + 3 {
        return Err("图片数据无效".into());
    }
    let val = |b: u8| -> Option<u8> {
        match b {
            b'A'..=b'Z' => Some(b - b'A'),
            b'a'..=b'z' => Some(b - b'a' + 26),
            b'0'..=b'9' => Some(b - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    let mut out = Vec::with_capacity((bytes.len() / 4) * 3);
    for (idx, chunk) in bytes.chunks_exact(4).enumerate() {
        let last = (idx + 1) * 4 == bytes.len();
        let (a, b) = (
            val(chunk[0]).ok_or("图片编码无效")?,
            val(chunk[1]).ok_or("图片编码无效")?,
        );
        let pad2 = chunk[2] == b'=';
        let pad3 = chunk[3] == b'=';
        if (pad2 || pad3) && !last {
            return Err("图片编码无效".into());
        }
        if pad2 && !pad3 {
            return Err("图片编码无效".into());
        }
        out.push((a << 2) | (b >> 4));
        if !pad2 {
            let c = val(chunk[2]).ok_or("图片编码无效")?;
            out.push((b << 4) | (c >> 2));
            if !pad3 {
                let d = val(chunk[3]).ok_or("图片编码无效")?;
                out.push((c << 6) | d);
            }
        }
        if out.len() > max_bytes {
            return Err("图片过大".into());
        }
    }
    Ok(out)
}

pub fn validate_exposure_png(bytes: &[u8]) -> Result<()> {
    validate_png(
        bytes,
        720,
        720,
        40,
        2_300_000,
        "相纸需要 720 × 720 的 PNG 原片",
    )
}

pub fn validate_print_png(bytes: &[u8]) -> Result<()> {
    validate_png(
        bytes,
        800,
        986,
        40,
        6_000_000,
        "拍立得图片需要 800 × 986 的 PNG",
    )
}

pub fn sanitize_png_filename(raw: &str) -> Result<String> {
    let name = Path::new(raw.trim())
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("文件名无效")?;
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        return Err("文件名无效".into());
    }
    let with_ext = if trimmed.to_ascii_lowercase().ends_with(".png") {
        trimmed.to_owned()
    } else {
        format!("{trimmed}.png")
    };
    if with_ext.len() > 120 {
        return Ok(format!(
            "{}.png",
            with_ext.chars().take(64).collect::<String>()
        ));
    }
    Ok(with_ext)
}

pub struct LocalAlbum {
    dir: PathBuf,
    disk: AlbumDisk,
}

impl LocalAlbum {
    pub fn open(root: &Path) -> Result<Self> {
        let dir = root.join("album");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let disk = match fs::read(dir.join("index.json")) {
            Ok(v) => serde_json::from_slice(&v)
                .map_err(|_| "相册索引无法读取，原文件已保留。".to_owned())?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => AlbumDisk::default(),
            Err(e) => return Err(e.to_string()),
        };
        Ok(Self { dir, disk })
    }

    fn commit(&mut self, next: AlbumDisk) -> Result<()> {
        let mut f = NamedTempFile::new_in(&self.dir).map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        f.write_all(&bytes)
            .and_then(|_| f.as_file().sync_all())
            .map_err(|e| e.to_string())?;
        f.persist(self.dir.join("index.json"))
            .map_err(|e| e.to_string())?;
        self.disk = next;
        Ok(())
    }

    pub fn list(
        &self,
        rabbit_name: &str,
        moment: Option<&str>,
        before: Option<&str>,
    ) -> Result<AlbumPage> {
        let moment = match moment {
            Some(m) if !m.is_empty() => Some(checked_moment(m)?),
            _ => None,
        };
        let cursor = match before {
            Some(c) if !c.is_empty() => Some(parse_cursor(c)?),
            _ => None,
        };
        let mut sorted = self.disk.photos.clone();
        sorted.sort_by(|a, b| b.captured.cmp(&a.captured).then_with(|| b.id.cmp(&a.id)));

        let mut covers = BTreeMap::new();
        for p in &sorted {
            if MOMENTS.contains(&p.pose.as_str()) && !covers.contains_key(&p.pose) {
                covers.insert(p.pose.clone(), p.id.clone());
            }
        }

        let filtered: Vec<Photo> = sorted
            .into_iter()
            .filter(|p| moment.is_none_or(|m| p.pose == m))
            .filter(|p| {
                cursor
                    .as_ref()
                    .is_none_or(|(t, id)| (p.captured, p.id.as_str()) < (*t, id.as_str()))
            })
            .take(13)
            .collect();

        let has_more = filtered.len() > 12;
        let photos: Vec<Photo> = filtered.into_iter().take(12).collect();
        let next = if has_more {
            photos
                .last()
                .map(|last| format!("{}.{}", last.captured, last.id))
        } else {
            None
        };

        Ok(AlbumPage {
            rabbit_name: rabbit_name.to_owned(),
            photos,
            next,
            covers,
        })
    }

    pub fn upload(&mut self, meta: UploadMeta, bytes: &[u8]) -> Result<Uploaded> {
        let title = validate_upload_meta(&meta)?;
        validate_exposure_png(bytes)?;
        let img_path = self.dir.join(format!("{}.png", meta.id));

        if let Some(existing) = self.disk.photos.iter().find(|p| p.id == meta.id) {
            let same_meta = existing.captured == meta.captured
                && existing.offset == meta.offset
                && existing.scene == meta.scene
                && existing.light == meta.light
                && existing.pose == meta.pose
                && existing.title == title;
            let same_bytes = fs::read(&img_path).is_ok_and(|stored| stored == bytes);
            if same_meta && same_bytes {
                return Ok(Uploaded {
                    id: existing.id.clone(),
                    title: existing.title.clone(),
                });
            }
            return Err("这张相纸已经用过了".into());
        }

        let mut f = NamedTempFile::new_in(&self.dir).map_err(|e| e.to_string())?;
        f.write_all(bytes)
            .and_then(|_| f.as_file().sync_all())
            .map_err(|e| e.to_string())?;
        f.persist(&img_path).map_err(|e| e.to_string())?;

        let mut next = self.disk.clone();
        next.photos.push(Photo {
            id: meta.id.clone(),
            captured: meta.captured,
            offset: meta.offset,
            scene: meta.scene,
            light: meta.light,
            pose: meta.pose,
            title: title.clone(),
            revision: 1,
        });
        self.commit(next)?;
        Ok(Uploaded { id: meta.id, title })
    }

    pub fn image(&self, id: &str) -> Result<Vec<u8>> {
        let id = checked_id(id)?;
        if !self.disk.photos.iter().any(|p| p.id == id) {
            return Err("找不到这张照片".into());
        }
        fs::read(self.dir.join(format!("{id}.png"))).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "找不到这张照片".into()
            } else {
                e.to_string()
            }
        })
    }

    pub fn rename_title(&mut self, id: &str, raw_title: &str, revision: i64) -> Result<Photo> {
        let id = checked_id(id)?;
        if revision < 1 {
            return Err("请重新翻开这张照片".into());
        }
        let title = checked_title(raw_title)?;
        let mut next = self.disk.clone();
        let Some(photo) = next.photos.iter_mut().find(|p| p.id == id) else {
            return Err("找不到这张照片".into());
        };
        if photo.revision != revision {
            return Err("这张照片刚刚改过，请重新翻开。".into());
        }
        photo.title = title;
        photo.revision += 1;
        let updated = photo.clone();
        self.commit(next)?;
        Ok(updated)
    }

    pub fn delete(&mut self, id: &str, revision: i64) -> Result<()> {
        let id = checked_id(id)?;
        if revision < 1 {
            return Err("请重新翻开这张照片".into());
        }
        let mut next = self.disk.clone();
        let Some(pos) = next.photos.iter().position(|p| p.id == id) else {
            return Err("找不到这张照片".into());
        };
        if next.photos[pos].revision != revision {
            return Err("这张照片刚刚改过，请重新翻开。".into());
        }
        next.photos.remove(pos);
        self.commit(next)?;
        match fs::remove_file(self.dir.join(format!("{id}.png"))) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_png(width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        let mut ihdr = [0u8; 13];
        ihdr[..4].copy_from_slice(&width.to_be_bytes());
        ihdr[4..8].copy_from_slice(&height.to_be_bytes());
        ihdr[8] = 8;
        ihdr[9] = 6;
        for (kind, data) in [
            (b"IHDR", ihdr.as_slice()),
            (b"IDAT", &[0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]),
            (b"IEND", &[]),
        ] {
            out.extend_from_slice(&(data.len() as u32).to_be_bytes());
            out.extend_from_slice(kind);
            out.extend_from_slice(data);
            out.extend_from_slice(&[0u8; 4]);
        }
        out
    }

    #[test]
    fn local_album_round_trip_pagination_and_validation() {
        let dir = tempfile::tempdir().unwrap();
        let mut album = LocalAlbum::open(dir.path()).unwrap();
        let png720 = sample_png(720, 720);
        let png800 = sample_png(800, 986);
        assert!(validate_exposure_png(&png720).is_ok());
        assert!(validate_exposure_png(&png800).is_err());
        assert!(validate_print_png(&png800).is_ok());
        assert_eq!(decode_base64("SGVsbG8=", 16).unwrap(), b"Hello");
        assert!(decode_base64("SGVsbG8", 16).is_err());

        let mut ids = vec![];
        for i in 0..14 {
            let id = Uuid::new_v4().to_string();
            ids.push(id.clone());
            let meta = UploadMeta {
                id: id.clone(),
                captured: 1_700_000_000_000 + i,
                offset: 540,
                scene: "snow".into(),
                light: "night".into(),
                pose: if i == 0 { "stump".into() } else { "nap".into() },
                title: format!("  照片 {i}  "),
            };
            let up = album.upload(meta.clone(), &png720).unwrap();
            assert_eq!(up.title, format!("照片 {i}"));
            // Idempotent retry
            assert_eq!(album.upload(meta, &png720).unwrap(), up);
        }

        // Conflicting reuse of same ID
        assert!(album
            .upload(
                UploadMeta {
                    id: ids[0].clone(),
                    captured: 1,
                    offset: 0,
                    scene: "paper".into(),
                    light: "day".into(),
                    pose: "pet".into(),
                    title: "x".into(),
                },
                &png720,
            )
            .is_err());

        // Invalid scene/light combinations rejected
        assert!(validate_upload_meta(&UploadMeta {
            id: Uuid::new_v4().to_string(),
            captured: 10,
            offset: 0,
            scene: "paper".into(),
            light: "day".into(),
            pose: "stump".into(),
            title: "".into(),
        })
        .is_err());

        let page1 = album.list("糯米", None, None).unwrap();
        assert_eq!(page1.rabbit_name, "糯米");
        assert_eq!(page1.photos.len(), 12);
        assert_eq!(page1.covers.get("nap"), Some(&ids[13]));
        assert_eq!(page1.covers.get("stump"), Some(&ids[0]));
        assert!(page1.next.is_some());

        let page2 = album.list("糯米", None, page1.next.as_deref()).unwrap();
        assert_eq!(page2.photos.len(), 2);
        assert!(page2.next.is_none());

        assert_eq!(album.image(&ids[0]).unwrap(), png720);
        let renamed = album.rename_title(&ids[0], " 雪桩后 ", 1).unwrap();
        assert_eq!((renamed.title.as_str(), renamed.revision), ("雪桩后", 2));
        assert!(album.rename_title(&ids[0], "冲突", 1).is_err());
        assert!(album.delete(&ids[0], 1).is_err());
        album.delete(&ids[0], 2).unwrap();
        assert!(album.image(&ids[0]).is_err());
        assert!(album
            .list("糯米", None, None)
            .unwrap()
            .covers
            .get("stump")
            .is_none());
    }
}
