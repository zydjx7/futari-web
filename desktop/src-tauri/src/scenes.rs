use crate::store::Result;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};
const IMAGE_LIMIT: u64 = 8 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Weather {
    Clear,
    Snow,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Layout {
    Landscape,
    SnowForest,
}
fn landscape() -> Layout {
    Layout::Landscape
}
fn horizon() -> f64 {
    0.54
}
fn foreground() -> f64 {
    0.85
}
fn clear() -> Weather {
    Weather::Clear
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub version: u32,
    pub title: String,
    #[serde(default = "horizon")]
    pub horizon: f64,
    #[serde(default = "foreground")]
    pub foreground_depth: f64,
    #[serde(default = "clear")]
    pub weather: Weather,
    #[serde(default = "landscape")]
    pub layout: Layout,
}
#[derive(Serialize)]
pub struct Pack {
    pub id: String,
    #[serde(flatten)]
    pub spec: Manifest,
}
#[derive(Copy, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Layer {
    Bg,
    Fg,
}
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 48
        && id != "clear"
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn safe(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path).map_err(|_| "场景文件不存在")?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("场景不能使用重解析点".into());
        }
    }
    if meta.file_type().is_symlink() {
        return Err("场景不能使用链接".into());
    }
    Ok(())
}
fn read(root: &Path, id: &str, name: &str, max: u64) -> Result<Vec<u8>> {
    if !valid_id(id) {
        return Err("场景目录名无效".into());
    }
    safe(root)?;
    let dir = root.join(id);
    safe(&dir)?;
    let path = dir.join(name);
    safe(&path)?;
    let base = root.canonicalize().map_err(|e| e.to_string())?;
    let expected = base.join(id).join(name);
    let file = File::open(&path).map_err(|e| e.to_string())?;
    if crate::platform::file_path(&file)? != expected {
        return Err("场景超出目录".into());
    }

    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > max {
        return Err("场景文件大小无效".into());
    }
    let mut data = Vec::with_capacity(meta.len() as usize);
    file.take(max + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() as u64 > max {
        return Err("场景过大".into());
    }
    Ok(data)
}
pub fn manifest(root: &Path, id: &str) -> Result<Manifest> {
    let s: Manifest = serde_json::from_slice(&read(root, id, "scene.json", 4096)?)
        .map_err(|_| "scene.json 格式无效")?;
    if s.version != 1
        || s.title.trim().is_empty()
        || s.title.chars().count() > 32
        || s.title.chars().any(char::is_control)
        || !(0.15..=0.84).contains(&s.horizon)
        || !(s.horizon..=1.).contains(&s.foreground_depth)
    {
        return Err("场景参数无效".into());
    }
    Ok(s)
}
pub fn list(root: &Path) -> Result<Vec<Pack>> {
    safe(root)?;
    let mut out = vec![];
    for e in fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .flatten()
        .take(256)
    {
        let id = e.file_name().to_string_lossy().into_owned();
        if let Ok(spec) = manifest(root, &id) {
            if ["bg.webp", "fg.webp"]
                .iter()
                .all(|n| safe(&e.path().join(n)).is_ok())
            {
                out.push(Pack { id, spec })
            }
        }
    }
    out.sort_by_key(|s| s.id.clone());
    Ok(out)
}
pub fn layer(root: &Path, id: &str, which: Layer) -> Result<Vec<u8>> {
    manifest(root, id)?;
    let b = read(
        root,
        id,
        match which {
            Layer::Bg => "bg.webp",
            Layer::Fg => "fg.webp",
        },
        IMAGE_LIMIT,
    )?;
    let dim = webp_dimensions(&b).ok_or("图片需要是静态 WebP")?;
    if dim.0 > 4096 || dim.1 > 4096 || u64::from(dim.0) * u64::from(dim.1) > 10_000_000 {
        return Err("图片尺寸过大".into());
    }
    Ok(b)
}
fn webp_dimensions(b: &[u8]) -> Option<(u32, u32)> {
    if b.len() < 25
        || &b[..4] != b"RIFF"
        || &b[8..12] != b"WEBP"
        || u32::from_le_bytes(b[4..8].try_into().ok()?) as usize != b.len() - 8
    {
        return None;
    }
    let le = |i: usize| Some(u32::from(*b.get(i)?) + (u32::from(*b.get(i + 1)?) << 8));
    match &b[12..16] {
        b"VP8X" if b.len() >= 30 && b[20] & 2 == 0 => Some((
            1 + le(24)? + (u32::from(b[26]) << 16),
            1 + le(27)? + (u32::from(b[29]) << 16),
        )),
        b"VP8 " if b.len() >= 30 && b[23..26] == [0x9d, 1, 0x2a] => {
            Some((le(26)? & 0x3fff, le(28)? & 0x3fff))
        }
        b"VP8L" if b[20] == 0x2f => {
            let v = u32::from_le_bytes(b[21..25].try_into().ok()?);
            Some((1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)))
        }
        _ => None,
    }
}
#[derive(Clone)]
pub struct Roots {
    pub user: PathBuf,
    builtin: PathBuf,
}
impl Roots {
    fn for_id(&self, id: &str) -> &Path {
        if id == "snow-forest" {
            &self.builtin
        } else {
            &self.user
        }
    }
    pub fn manifest(&self, id: &str) -> Result<Manifest> {
        manifest(self.for_id(id), id)
    }
    pub fn layer(&self, id: &str, which: Layer) -> Result<Vec<u8>> {
        layer(self.for_id(id), id, which)
    }
    pub fn list(&self) -> Result<Vec<Pack>> {
        let mut packs = list(&self.user)?;
        if self.builtin != self.user {
            packs.retain(|p| p.id != "snow-forest");
            let id = "snow-forest";
            packs.push(Pack {
                id: id.into(),
                spec: self.manifest(id)?,
            });
            packs.sort_by(|a, b| a.id.cmp(&b.id));
        }
        Ok(packs)
    }
}
#[cfg(target_os = "macos")]
pub fn roots(save: &Path) -> Result<Roots> {
    let user = save.join("scenes");
    safe(save)?;
    fs::create_dir_all(&user).map_err(|e| e.to_string())?;
    safe(&user)?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let contents = exe
        .parent()
        .and_then(Path::parent)
        .ok_or("无法定位应用程序包")?;
    let mut builtin = contents.join("Resources/scenes");
    if cfg!(debug_assertions) && !builtin.is_dir() {
        builtin = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scenes");
    }
    safe(&builtin)?;
    Ok(Roots { user, builtin })
}
#[cfg(windows)]
pub fn roots(_save: &Path) -> Result<Roots> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let portable = exe.parent().ok_or("没有程序目录")?.join("scenes");
    Ok(Roots {
        user: portable.clone(),
        builtin: portable,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn builtin_has_priority_and_user_paths_are_confined() {
        let builtin = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scenes");
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("snow-forest")).unwrap();
        let roots = Roots {
            user: dir.path().into(),
            builtin,
        };
        assert_eq!(roots.list().unwrap().len(), 1);
        assert!(roots.layer("snow-forest", Layer::Bg).is_ok());
        assert!(roots.layer("../snow-forest", Layer::Bg).is_err());
    }
    #[test]
    fn scene_bounds() {
        let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scenes");
        let scene = list(&p).unwrap();
        assert!(scene.iter().any(|s| s.id == "snow-forest"));
        for i in [Layer::Fg, Layer::Bg] {
            assert!(!layer(&p, "snow-forest", i).unwrap().is_empty())
        }
        assert!(layer(&p, "../", Layer::Bg).is_err());
        assert!(webp_dimensions(b"<script>").is_none());
    }
}
