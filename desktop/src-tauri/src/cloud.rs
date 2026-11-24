use crate::{
    album::{
        checked_id, checked_moment, checked_title, parse_cursor, validate_exposure_png,
        validate_upload_meta, AlbumPage, Photo, UploadMeta, Uploaded,
    },
    platform::credentials,
    store::{checked_atmosphere, Act, Action, Home, Mail, Result},
};
use reqwest::{header::CONTENT_TYPE, redirect::Policy, Client, Method};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::Duration;
const BRIDGE: &str = "https://futari-desktop.paper-notes-c2909a30.workers.dev";
fn permitted_album_query(query: &str) -> bool {
    let mut seen_moment = false;
    let mut seen_before = false;
    let mut count = 0;
    for part in query.split('&') {
        count += 1;
        if count > 2 {
            return false;
        }
        if let Some(m) = part.strip_prefix("moment=") {
            if seen_moment || checked_moment(m).is_err() {
                return false;
            }
            seen_moment = true;
        } else if let Some(b) = part.strip_prefix("before=") {
            if seen_before || parse_cursor(b).is_err() {
                return false;
            }
            seen_before = true;
        } else {
            return false;
        }
    }
    count > 0
}
fn permitted(method: &Method, path: &str) -> bool {
    if method == Method::GET {
        if path
            .strip_prefix("update/ui/")
            .is_some_and(crate::updater::version)
        {
            return true;
        }
        if matches!(path, "update/manifest" | "state" | "mail" | "album") {
            return true;
        }
        if let Some(s) = path.strip_prefix("mail?before=") {
            return s.parse::<i64>().is_ok_and(|v| v > 0 && v.to_string() == s);
        }
        if let Some(q) = path.strip_prefix("album?") {
            return permitted_album_query(q);
        }
        if let Some(id) = path
            .strip_prefix("album/")
            .and_then(|rest| rest.strip_suffix("/image"))
        {
            return checked_id(id).is_ok();
        }
        return false;
    }
    if method != Method::POST {
        return false;
    }
    if matches!(
        path,
        "session"
            | "logout"
            | "pulse"
            | "visit"
            | "pet"
            | "feed"
            | "buy"
            | "place"
            | "open-letter"
            | "rename"
            | "atmosphere"
            | "album"
    ) {
        return true;
    }
    if let Some(rest) = path.strip_prefix("album/") {
        if let Some(id) = rest
            .strip_suffix("/title")
            .or_else(|| rest.strip_suffix("/delete"))
        {
            return checked_id(id).is_ok();
        }
    }
    false
}
fn desktop_token(token: &str) -> bool {
    let mut parts = token.split('.');
    let (Some("d1"), Some(id), Some(expires), Some(signature), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return false;
    };
    uuid::Uuid::parse_str(id).is_ok_and(|v| v.to_string() == id)
        && (10..=11).contains(&expires.len())
        && expires.bytes().all(|b| b.is_ascii_digit())
        && signature.len() == 64
        && signature
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn credential() -> Result<String> {
    credentials::read()?
        .filter(|t| desktop_token(t))
        .ok_or_else(|| "请在设置中重新连接云端兔窝".into())
}
#[derive(Deserialize)]
struct Login {
    token: String,
}
#[derive(Deserialize)]
struct Fault {
    error: String,
}
#[derive(Deserialize)]
struct OkReply {
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    applied: Option<bool>,
}
#[derive(Serialize)]
struct Pass<'a> {
    passcode: &'a str,
}
pub struct Cloud {
    client: Client,
}
impl Cloud {
    pub async fn manifest(&self) -> Result<crate::updater::Manifest> {
        self.request(
            Method::GET,
            "update/manifest",
            None::<&()>,
            Some(&credential()?),
        )
        .await
    }
    pub async fn bundle(&self, version: &str) -> Result<Vec<u8>> {
        let path = format!("update/ui/{version}");
        if !permitted(&Method::GET, &path) {
            return Err("版本无效".into());
        }
        let mut r = self
            .client
            .get(format!("{BRIDGE}/v1/{path}"))
            .bearer_auth(credential()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !r.status().is_success()
            || r.headers().get(CONTENT_TYPE).and_then(|h| h.to_str().ok())
                != Some("application/zip")
            || r.content_length()
                .is_some_and(|n| n > crate::updater::LIMIT as u64)
        {
            return Err("资源包响应无效".into());
        }
        let mut bytes = vec![];
        while let Some(chunk) = r.chunk().await.map_err(|e| e.to_string())? {
            if bytes.len() + chunk.len() > crate::updater::LIMIT {
                return Err("资源包过大".into());
            }
            bytes.extend_from_slice(&chunk)
        }
        Ok(bytes)
    }
    pub fn new() -> Result<Self> {
        Ok(Self {
            client: Client::builder()
                .https_only(true)
                .redirect(Policy::none())
                .timeout(Duration::from_secs(9))
                .build()
                .map_err(|e| e.to_string())?,
        })
    }
    async fn request<T: DeserializeOwned, B: Serialize>(
        &self,
        method: Method,
        path: &str,
        payload: Option<&B>,
        token: Option<&str>,
    ) -> Result<T> {
        if !permitted(&method, path) {
            return Err("桌面接口无效".into());
        }
        let mut req = self
            .client
            .request(method, format!("{BRIDGE}/v1/{path}"))
            .header("Accept", "application/json");
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        if let Some(data) = payload {
            req = req.json(data);
        }
        let mut r = req
            .send()
            .await
            .map_err(|_| "云端未连接，请检查网络及桌面 JSON 服务")?;
        if r.headers()
            .get(CONTENT_TYPE)
            .and_then(|s| s.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            != Some("application/json")
        {
            return Err("此地址尚未提供 FUTARI 桌面 JSON 服务".into());
        }
        if r.content_length().is_some_and(|n| n > 131072) {
            return Err("服务响应过大".into());
        }
        let status = r.status();
        let mut bytes = vec![];
        while let Some(part) = r.chunk().await.map_err(|_| "响应中断")? {
            if bytes.len() + part.len() > 131072 {
                return Err("服务响应过大".into());
            }
            bytes.extend_from_slice(&part);
        }
        if !status.is_success() {
            return Err(serde_json::from_slice::<Fault>(&bytes)
                .map(|e| e.error.chars().take(100).collect())
                .unwrap_or_else(|_| "云端暂时不可用".into()));
        }
        serde_json::from_slice(&bytes).map_err(|_| "云端数据格式不匹配".into())
    }
    pub async fn login(&self, pass: &str) -> Result<()> {
        if !(8..=256).contains(&pass.chars().count()) {
            return Err("暗号格式无效".into());
        }
        let r: Login = self
            .request(
                Method::POST,
                "session",
                Some(&Pass { passcode: pass }),
                None,
            )
            .await?;
        if !desktop_token(&r.token) {
            return Err("会话格式无效".into());
        }
        credentials::write(&r.token)
    }
    pub async fn home(&self) -> Result<Home> {
        let mut home: Home = self
            .request::<_, ()>(Method::GET, "state", None, Some(&credential()?))
            .await?;
        home.name = crate::store::checked_name(&home.name)?.to_owned();
        home.atmosphere = checked_atmosphere(&home.atmosphere)
            .unwrap_or("auto")
            .to_owned();
        Ok(home)
    }
    pub async fn set_atmosphere(&self, raw: &str) -> Result<String> {
        #[derive(Serialize)]
        struct Atmosphere<'a> {
            atmosphere: &'a str,
        }
        let atmosphere = checked_atmosphere(raw)?;
        let _: serde::de::IgnoredAny = self
            .request(
                Method::POST,
                "atmosphere",
                Some(&Atmosphere { atmosphere }),
                Some(&credential()?),
            )
            .await?;
        Ok(atmosphere.to_owned())
    }
    pub async fn album_list(
        &self,
        moment: Option<&str>,
        before: Option<&str>,
    ) -> Result<AlbumPage> {
        let mut params = vec![];
        if let Some(m) = moment.filter(|s| !s.is_empty()) {
            params.push(format!("moment={}", checked_moment(m)?));
        }
        if let Some(b) = before.filter(|s| !s.is_empty()) {
            let (t, id) = parse_cursor(b)?;
            params.push(format!("before={t}.{id}"));
        }
        let path = if params.is_empty() {
            "album".into()
        } else {
            format!("album?{}", params.join("&"))
        };
        let mut page: AlbumPage = self
            .request::<_, ()>(Method::GET, &path, None, Some(&credential()?))
            .await?;
        page.rabbit_name = crate::store::checked_name(&page.rabbit_name)?.to_owned();
        Ok(page)
    }
    pub async fn album_upload(&self, meta: &UploadMeta, png_bytes: &[u8]) -> Result<Uploaded> {
        let title = validate_upload_meta(meta)?;
        validate_exposure_png(png_bytes)?;
        let token = credential()?;
        let boundary = format!("----futari{}", uuid::Uuid::new_v4().simple());
        let mut body = Vec::with_capacity(png_bytes.len() + 1024);
        let captured = meta.captured.to_string();
        let offset = meta.offset.to_string();
        for (k, v) in [
            ("id", meta.id.as_str()),
            ("captured", captured.as_str()),
            ("offset", offset.as_str()),
            // The cloud album currently accepts only its two original scene identifiers.
            (
                "scene",
                if meta.scene == "desktop" {
                    "paper"
                } else {
                    &meta.scene
                },
            ),
            ("light", meta.light.as_str()),
            ("pose", meta.pose.as_str()),
            ("title", title.as_str()),
        ] {
            body.extend_from_slice(
                format!(
                    "--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n"
                )
                .as_bytes(),
            );
        }
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"exposure.png\"\r\nContent-Type: image/png\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(png_bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

        let mut r = self
            .client
            .post(format!("{BRIDGE}/v1/album"))
            .header("Accept", "application/json")
            .header(
                CONTENT_TYPE,
                format!("multipart/form-data; boundary={boundary}"),
            )
            .bearer_auth(&token)
            .timeout(Duration::from_secs(20))
            .body(body)
            .send()
            .await
            .map_err(|_| "云端未连接，请检查网络及桌面 JSON 服务")?;
        if r.headers()
            .get(CONTENT_TYPE)
            .and_then(|s| s.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            != Some("application/json")
        {
            return Err("此地址尚未提供 FUTARI 桌面 JSON 服务".into());
        }
        if r.content_length().is_some_and(|n| n > 131072) {
            return Err("服务响应过大".into());
        }
        let status = r.status();
        let mut bytes = vec![];
        while let Some(part) = r.chunk().await.map_err(|_| "响应中断")? {
            if bytes.len() + part.len() > 131072 {
                return Err("服务响应过大".into());
            }
            bytes.extend_from_slice(&part);
        }
        if !status.is_success() {
            return Err(serde_json::from_slice::<Fault>(&bytes)
                .map(|e| e.error.chars().take(100).collect())
                .unwrap_or_else(|_| "云端暂时不可用".into()));
        }
        serde_json::from_slice(&bytes).map_err(|_| "云端数据格式不匹配".into())
    }
    pub async fn album_image(&self, id: &str) -> Result<Vec<u8>> {
        let id = checked_id(id)?;
        let path = format!("album/{id}/image");
        if !permitted(&Method::GET, &path) {
            return Err("桌面接口无效".into());
        }
        let mut r = self
            .client
            .get(format!("{BRIDGE}/v1/{path}"))
            .bearer_auth(&credential()?)
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .map_err(|_| "云端未连接，请检查网络及桌面 JSON 服务")?;
        let ct = r
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|s| s.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .to_owned();
        if !r.status().is_success() {
            let mut err_bytes = vec![];
            while let Some(part) = r.chunk().await.map_err(|_| "响应中断")? {
                if err_bytes.len() + part.len() > 32768 {
                    break;
                }
                err_bytes.extend_from_slice(&part);
            }
            return Err(serde_json::from_slice::<Fault>(&err_bytes)
                .map(|e| e.error.chars().take(100).collect())
                .unwrap_or_else(|_| "这张照片已经取下了。".into()));
        }
        if ct != "image/png" {
            return Err("图片格式不匹配".into());
        }
        if r.content_length().is_some_and(|n| n > 2_500_000) {
            return Err("图片过大".into());
        }
        let mut bytes = vec![];
        while let Some(part) = r.chunk().await.map_err(|_| "响应中断")? {
            if bytes.len() + part.len() > 2_500_000 {
                return Err("图片过大".into());
            }
            bytes.extend_from_slice(&part);
        }
        Ok(bytes)
    }
    pub async fn album_title(&self, id: &str, raw_title: &str, revision: i64) -> Result<Photo> {
        #[derive(Serialize)]
        struct TitleEdit {
            title: String,
            revision: i64,
        }
        let id = checked_id(id)?;
        if revision < 1 {
            return Err("请重新翻开这张照片".into());
        }
        let title = checked_title(raw_title)?;
        self.request(
            Method::POST,
            &format!("album/{id}/title"),
            Some(&TitleEdit { title, revision }),
            Some(&credential()?),
        )
        .await
    }
    pub async fn album_delete(&self, id: &str, revision: i64) -> Result<()> {
        #[derive(Serialize)]
        struct DeletePhoto {
            revision: i64,
        }
        let id = checked_id(id)?;
        if revision < 1 {
            return Err("请重新翻开这张照片".into());
        }
        let _: serde::de::IgnoredAny = self
            .request(
                Method::POST,
                &format!("album/{id}/delete"),
                Some(&DeletePhoto { revision }),
                Some(&credential()?),
            )
            .await?;
        Ok(())
    }
    pub async fn rename(&self, raw: &str) -> Result<String> {
        #[derive(Deserialize, Serialize)]
        struct Name {
            name: String,
        }
        let name = crate::store::checked_name(raw)?.to_owned();
        let saved: Name = self
            .request(
                Method::POST,
                "rename",
                Some(&Name { name }),
                Some(&credential()?),
            )
            .await?;
        Ok(crate::store::checked_name(&saved.name)?.to_owned())
    }
    pub async fn mail(&self, before: Option<i64>) -> Result<Mail> {
        let path = before
            .map(|n| format!("mail?before={n}"))
            .unwrap_or_else(|| "mail".into());
        self.request::<_, ()>(Method::GET, &path, None, Some(&credential()?))
            .await
    }
    pub async fn simple(&self, name: &'static str) -> Result<()> {
        let _: serde::de::IgnoredAny = self
            .request(
                Method::POST,
                name,
                Some(&serde_json::json!({})),
                Some(&credential()?),
            )
            .await?;
        Ok(())
    }
    pub async fn revoke(&self, token: &str) {
        if desktop_token(token) {
            let _: Result<serde::de::IgnoredAny> = self
                .request(
                    Method::POST,
                    "logout",
                    Some(&serde_json::json!({})),
                    Some(token),
                )
                .await;
        }
    }
    pub async fn act(&self, a: &Action) -> Result<()> {
        let path = match a.kind {
            Act::Pet => "pet",
            Act::Buy => "buy",
            Act::Feed => "feed",
            Act::Place => "place",
            Act::OpenLetter => "open-letter",
        };
        let mut args = serde_json::json!({"item":a.item,"request_id":a.request_id,"id":a.letter});
        if let Some(on) = a.placed {
            args["placed"] = on.into();
        }
        let r: OkReply = self
            .request(Method::POST, path, Some(&args), Some(&credential()?))
            .await?;
        if !r.ok && r.applied.is_none() {
            return Err("云端未确认操作".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixed_json_routes_and_scoped_credentials() {
        for p in [
            "session",
            "logout",
            "pulse",
            "visit",
            "pet",
            "feed",
            "buy",
            "place",
            "open-letter",
            "rename",
            "atmosphere",
            "album",
        ] {
            assert!(permitted(&Method::POST, p));
            assert!(!permitted(&Method::GET, p) || p == "album");
        }
        let sample_id = uuid::Uuid::new_v4().to_string();
        assert!(permitted(&Method::GET, &format!("album/{sample_id}/image")));
        assert!(!permitted(
            &Method::POST,
            &format!("album/{sample_id}/image")
        ));
        assert!(permitted(
            &Method::POST,
            &format!("album/{sample_id}/title")
        ));
        assert!(permitted(
            &Method::POST,
            &format!("album/{sample_id}/delete")
        ));
        assert!(!permitted(&Method::POST, "album/not-a-uuid/title"));
        for p in [
            "state",
            "mail",
            "mail?before=42",
            "album",
            "album?moment=stump",
            &format!("album?moment=nap&before=1700000000000.{sample_id}"),
        ] {
            assert!(permitted(&Method::GET, p), "{p}");
        }
        for p in [
            "menu",
            "mail?before=-1",
            "mail?before=3&more=1",
            "album?moment=bad",
            "album?before=bad",
            "album?moment=nap&moment=pet",
            "album/bad/image",
            "https://elsewhere.invalid",
        ] {
            assert!(!permitted(&Method::GET, p), "{p}");
        }
        let web = format!("{}.1900000000.{}", uuid::Uuid::new_v4(), "a".repeat(64));
        assert!(!desktop_token(&web));
        assert!(desktop_token(&format!("d1.{web}")));
        assert!(!desktop_token("d1.bad"));
    }
}
