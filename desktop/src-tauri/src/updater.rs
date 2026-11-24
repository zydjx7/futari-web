use crate::{App, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager};
// This shell splits movement from window layers. Earlier UI bundles implement
// the four-state shortcut and include the outline atlases.
const UI_GENERATION: &str = "0.2.4";
pub const LIMIT: usize = 16 << 20;
pub const ORIGIN: &str = if cfg!(windows) {
    "http://futari-ui.localhost"
} else {
    "futari-ui://localhost"
};
static ROOT: OnceLock<PathBuf> = OnceLock::new();
static LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub version: String,
    pub min_app_version: String,
    pub sha256: String,
    pub signature: String,
    pub size: usize,
}
#[derive(Deserialize)]
pub struct Manifest {
    pub ui: Option<Release>,
    #[allow(dead_code)]
    pub app: Option<AppRelease>,
}
#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRelease {
    pub version: String,
    #[serde(default)]
    pub platforms: std::collections::BTreeMap<String, BinaryAsset>,
}
#[allow(dead_code)]
#[derive(Deserialize)]
pub struct BinaryAsset {
    pub sha256: String,
    pub signature: String,
    pub size: u64,
}
// Phase two: fetch a platform entry through the same /v1/update/* bridge and verify
// its Ed25519 signature. After shutdown a helper can rename the portable Windows
// EXE or macOS .app aside, install the replacement, and restore it on failed start.
#[derive(Default, Serialize, Deserialize)]
struct State {
    active: Option<String>,
    pending: Option<String>,
    failed: Vec<String>,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn init(path: &Path) -> Result<()> {
    let root = path.join("ui-cache").join(UI_GENERATION);
    fs::create_dir_all(root.join("releases")).map_err(err)?;
    ROOT.set(root).map_err(|_| "缓存已初始化".to_string())
}
fn root() -> Result<&'static PathBuf> {
    ROOT.get().ok_or("缓存尚未初始化".into())
}
fn state() -> State {
    root()
        .ok()
        .and_then(|p| fs::read(p.join("state.json")).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}
fn save(s: &State) -> Result<()> {
    let mut f = tempfile::NamedTempFile::new_in(root()?).map_err(err)?;
    serde_json::to_writer(&mut f, s).map_err(err)?;
    f.flush().map_err(err)?;
    f.as_file().sync_all().map_err(err)?;
    f.persist(root()?.join("state.json")).map_err(err)?;
    Ok(())
}
pub fn version(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 40
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        && safe_part(v)
}
fn safe_part(s: &str) -> bool {
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    !s.is_empty()
        && !s.starts_with('.')
        && !s.ends_with(['.', ' '])
        && !s.contains(['\\', ':', '%', '\0'])
        && !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        && !stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"))
            .is_some_and(|n| {
                matches!(
                    n,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        && !s.chars().any(|ch| ch.is_control() || "<>|?*".contains(ch))
}
fn relative(s: &str) -> bool {
    s.split('/').all(safe_part)
        && Path::new(s)
            .components()
            .all(|p| matches!(p, Component::Normal(_)))
}
pub fn active_file(name: &str) -> Option<PathBuf> {
    if !relative(name) {
        return None;
    }
    let v = state().active?;
    if !version(&v) {
        return None;
    }
    let r = root().ok()?.canonicalize().ok()?;
    let base = r.join("releases").join(v);
    let file = base.join(name).canonicalize().ok()?;
    if !file.starts_with(&base) || !file.is_file() {
        return None;
    }
    Some(file)
}
fn verify(r: &Release, bytes: &[u8]) -> Result<()> {
    verify_with(r, bytes, include_bytes!("../update-public-key.bin"))
}
fn verify_with(r: &Release, bytes: &[u8], public: &[u8; 32]) -> Result<()> {
    if !version(&r.version)
        || bytes.len() != r.size
        || r.size > LIMIT
        || format!("{:x}", Sha256::digest(bytes)) != r.sha256
    {
        return Err("资源包校验失败".into());
    }
    if semver::Version::parse(&r.min_app_version).map_err(err)?
        > semver::Version::parse(env!("CARGO_PKG_VERSION")).map_err(err)?
    {
        return Err("需要新版桌宠".into());
    }
    let key = VerifyingKey::from_bytes(public).map_err(err)?;
    key.verify_strict(
        bytes,
        &Signature::from_slice(&STANDARD.decode(&r.signature).map_err(err)?).map_err(err)?,
    )
    .map_err(err)
}
fn unpack(bytes: &[u8], dir: &Path) -> Result<()> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(err)?;
    let mut remaining = 64u64 << 20;
    if z.len() > 1024 {
        return Err("包内文件过多".into());
    }
    for i in 0..z.len() {
        let e = z.by_index(i).map_err(err)?;
        if !relative(e.name())
            || e.is_dir()
            || e.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
            || e.size() > remaining
        {
            return Err("包内路径或长度无效".into());
        }
        let path = dir.join(e.name());
        fs::create_dir_all(path.parent().unwrap()).map_err(err)?;
        let mut f = fs::File::create_new(path).map_err(err)?;
        let size = e.size();
        if std::io::copy(&mut e.take(size + 1), &mut f).map_err(err)? != size {
            return Err("解压大小不一致".into());
        }
        remaining -= size;
    }
    for f in [
        "stage.js",
        "card.js",
        "stage.css",
        "card.css",
        "catalog.json",
    ] {
        if !dir.join(f).is_file() {
            return Err(format!("资源包缺少 {f}"));
        }
    }
    Ok(())
}
#[tauri::command]
pub fn ui_bundle_info() -> serde_json::Value {
    let s = state();
    serde_json::json!({"active":s.active,"origin":ORIGIN})
}
#[tauri::command]
pub fn update_status() -> serde_json::Value {
    let s = state();
    serde_json::json!({"active":s.active,"pending":s.pending,"app":env!("CARGO_PKG_VERSION")})
}
fn blacklist(s: &mut State, v: String) {
    s.failed.push(v);
    s.active = None;
}
fn reload(app: &AppHandle) -> Result<()> {
    for name in ["wallpaper", "furnishings", "stage", "card"] {
        if let Some(w) = app.get_webview_window(name) {
            w.reload().map_err(err)?
        }
    }
    Ok(())
}
#[tauri::command]
pub fn ui_bundle_rollback(app: AppHandle, version: String) -> Result<()> {
    let _g = LOCK.lock().unwrap();
    let mut s = state();
    if s.active.as_ref() == Some(&version) {
        blacklist(&mut s, version);
        save(&s)?;
        reload(&app)?
    }
    Ok(())
}
#[tauri::command]
pub fn apply_ui_update(app: AppHandle) -> Result<()> {
    let _g = LOCK.lock().unwrap();
    let mut s = state();
    if let Some(v) = s.pending.take() {
        s.active = Some(v);
        save(&s)?;
        reload(&app)?
    }
    Ok(())
}
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<()> {
    let a = app.state::<App>();
    let _account = a.account.lock().await;
    {
        let c = a.core();
        if c.locked || !c.store.settings().cloud {
            return Ok(());
        }
    }
    let Some(r) = a.cloud.manifest().await?.ui else {
        return Ok(());
    };
    if semver::Version::parse(&r.min_app_version).map_err(err)?
        < semver::Version::parse(UI_GENERATION).map_err(err)?
    {
        return Ok(());
    }
    let s = state();
    if !version(&r.version)
        || s.failed.contains(&r.version)
        || s.active.as_ref() == Some(&r.version)
        || s.pending.as_ref() == Some(&r.version)
    {
        return Ok(());
    }
    if r.size == 0
        || r.size > LIMIT
        || semver::Version::parse(&r.min_app_version).map_err(err)?
            > semver::Version::parse(env!("CARGO_PKG_VERSION")).map_err(err)?
    {
        return Err("资源包大小或最低桌宠版本不兼容".into());
    }
    if a.core().locked {
        return Ok(());
    }
    let bytes = a.cloud.bundle(&r.version).await?;
    verify(&r, &bytes)?;
    let _g = LOCK.lock().unwrap();
    let mut s = state();
    if s.failed.contains(&r.version) || s.active.as_ref() == Some(&r.version) {
        return Ok(());
    }
    let releases = root()?.join("releases");
    let tmp = tempfile::tempdir_in(&releases).map_err(err)?;
    unpack(&bytes, tmp.path())?;
    let dest = releases.join(&r.version);
    if s.active
        .as_ref()
        .is_some_and(|v| v.eq_ignore_ascii_case(&r.version))
    {
        return Ok(());
    }
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(err)?
    }
    fs::rename(tmp.path(), dest).map_err(err)?;
    s.pending = Some(r.version);
    save(&s)?;
    for e in fs::read_dir(releases).map_err(err)?.flatten() {
        let v = e.file_name().to_string_lossy().to_string();
        if version(&v)
            && s.active.as_ref() != Some(&v)
            && s.pending.as_ref() != Some(&v)
            && e.file_type().map_err(err)?.is_dir()
        {
            fs::remove_dir_all(e.path()).map_err(err)?
        }
    }
    let _ = app.emit_to("card", "update-ready", ());
    Ok(())
}
pub fn serve(path: &str) -> tauri::http::Response<Vec<u8>> {
    let name = path.strip_prefix('/').unwrap_or("");
    let data = active_file(name).and_then(|p| fs::read(p).ok());
    let mime = match name.rsplit('.').next() {
        Some("js") => "text/javascript",
        Some("css") => "text/css",
        Some("webp") => "image/webp",
        Some("png") => "image/png",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    };
    tauri::http::Response::builder()
        .status(if data.is_some() { 200 } else { 404 })
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .header(
            "Access-Control-Allow-Origin",
            if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            },
        )
        .body(data.unwrap_or_default())
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    #[test]
    fn signed_release_and_tamper() {
        let k = SigningKey::from_bytes(&[23; 32]);
        let data = b"sample";
        let mut r = Release {
            version: "test-1".into(),
            min_app_version: "0.2.0".into(),
            size: 6,
            sha256: format!("{:x}", Sha256::digest(data)),
            signature: STANDARD.encode(k.sign(data).to_bytes()),
        };
        assert!(verify_with(&r, data, k.verifying_key().as_bytes()).is_ok());
        r.sha256 = format!("{:x}", Sha256::digest(b"tamper"));
        assert!(verify_with(&r, b"tamper", k.verifying_key().as_bytes()).is_err());
    }
    #[test]
    fn unsafe_archive_and_failed_release() {
        let temp = tempfile::tempdir().unwrap();
        let out = std::io::Cursor::new(Vec::new());
        let mut z = zip::ZipWriter::new(out);
        z.start_file("../escape", zip::write::SimpleFileOptions::default())
            .unwrap();
        z.write_all(b"bad").unwrap();
        assert!(unpack(&z.finish().unwrap().into_inner(), temp.path()).is_err());
        let mut s = State {
            active: Some("bad".into()),
            ..State::default()
        };
        blacklist(&mut s, "bad".into());
        let saved: State = serde_json::from_slice(&serde_json::to_vec(&s).unwrap()).unwrap();
        assert!(saved.active.is_none() && saved.failed.contains(&"bad".into()));
    }
}
