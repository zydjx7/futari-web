use crate::{
    album::{AlbumPage, Photo, UploadMeta, Uploaded},
    store::{Action, Home, Mail, Result},
};
pub struct Cloud;
const OFFLINE: &str = "这个绿色版使用本机存档";
impl Cloud {
    pub async fn manifest(&self) -> Result<crate::updater::Manifest> {
        Err(OFFLINE.into())
    }
    pub async fn bundle(&self, _: &str) -> Result<Vec<u8>> {
        Err(OFFLINE.into())
    }
    pub fn new() -> Result<Self> {
        Ok(Self)
    }
    pub async fn login(&self, _: &str) -> Result<()> {
        Err(OFFLINE.into())
    }
    pub async fn home(&self) -> Result<Home> {
        Err(OFFLINE.into())
    }
    pub async fn rename(&self, _: &str) -> Result<String> {
        Err(OFFLINE.into())
    }
    pub async fn set_atmosphere(&self, _: &str) -> Result<String> {
        Err(OFFLINE.into())
    }
    pub async fn album_list(&self, _: Option<&str>, _: Option<&str>) -> Result<AlbumPage> {
        Err(OFFLINE.into())
    }
    pub async fn album_upload(&self, _: &UploadMeta, _: &[u8]) -> Result<Uploaded> {
        Err(OFFLINE.into())
    }
    pub async fn album_image(&self, _: &str) -> Result<Vec<u8>> {
        Err(OFFLINE.into())
    }
    pub async fn album_title(&self, _: &str, _: &str, _: i64) -> Result<Photo> {
        Err(OFFLINE.into())
    }
    pub async fn album_delete(&self, _: &str, _: i64) -> Result<()> {
        Err(OFFLINE.into())
    }
    pub async fn mail(&self, _: Option<i64>) -> Result<Mail> {
        Err(OFFLINE.into())
    }
    pub async fn act(&self, _: &Action) -> Result<()> {
        Err(OFFLINE.into())
    }
    pub async fn simple(&self, _: &'static str) -> Result<()> {
        Err(OFFLINE.into())
    }
}
