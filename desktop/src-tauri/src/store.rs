use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, VecDeque},
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, String>;
pub fn default_name() -> String {
    "焦糖兔".into()
}
pub fn default_atmosphere() -> String {
    "auto".into()
}
pub fn checked_atmosphere(raw: &str) -> Result<&str> {
    match raw {
        "auto" | "day" | "dusk" | "night" => Ok(raw),
        _ => Err("没有这页光影".into()),
    }
}
pub fn checked_name(raw: &str) -> Result<&str> {
    // Match JavaScript String.trim(), including BOM and excluding NEL.
    let name = raw.trim_matches(|c: char| c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}'));
    if !(1..=12).contains(&name.chars().count()) {
        return Err("名字可以写 1 到 12 个字。".into());
    }
    if name
        .chars()
        .any(|c| c <= '\u{1f}' || matches!(c, '\u{7f}' | '\u{2028}' | '\u{2029}'))
    {
        return Err("把名字写在一行里吧。".into());
    }
    Ok(name)
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn day(t: u64) -> u64 {
    (t + 9 * 3600) / 86400
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Hidden,
    Desktop,
    Overlay,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Patrol {
    Taskbar,
    Corner,
    Custom,
    Full,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Fence {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
impl Fence {
    pub fn valid(self) -> bool {
        [self.x, self.y, self.w, self.h]
            .iter()
            .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
            && self.w >= 0.035
            && self.h >= 0.035
            && self.x + self.w <= 1.00001
            && self.y + self.h <= 1.00001
    }
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(default)]
pub struct Settings {
    pub mode: Mode,
    pub last: Mode,
    pub patrol: Patrol,
    pub fence: Option<Fence>,
    pub scene: String,
    #[serde(default = "default_atmosphere")]
    pub atmosphere: String,
    pub wallpaper: bool,
    pub wallpaper_above_icons: bool,
    pub auto_rest: bool,
    pub rabbit_scale: u16,
    pub prop_scale: u16,
    pub cloud: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            mode: Mode::Overlay,
            last: Mode::Overlay,
            patrol: Patrol::Taskbar,
            fence: None,
            scene: "clear".into(),
            atmosphere: default_atmosphere(),
            wallpaper: false,
            wallpaper_above_icons: false,
            auto_rest: true,
            rabbit_scale: 100,
            prop_scale: 100,
            cloud: false,
        }
    }
}
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug, Serialize, Deserialize)]
#[serde(try_from = "String")]
pub struct ItemId(pub String);
impl TryFrom<String> for ItemId {
    type Error = String;
    fn try_from(value: String) -> Result<Self> {
        if value.len() <= 32
            && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
            && value
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
        {
            Ok(Self(value))
        } else {
            Err("商品编号无效".into())
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Product {
    pub name: String,
    pub price: i64,
    pub nourishment: u32,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub slot: Option<String>,
}
pub fn catalog() -> BTreeMap<ItemId, Product> {
    load_catalog(crate::updater::active_file("catalog.json").as_deref())
}
fn load_catalog(path: Option<&Path>) -> BTreeMap<ItemId, Product> {
    if let Some(c) = path
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
    {
        return c;
    }
    serde_json::from_str(include_str!("../catalog.json")).expect("packaged shop catalog")
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Home {
    #[serde(default = "default_name")]
    pub name: String,
    #[serde(default = "default_atmosphere")]
    pub atmosphere: String,
    pub balance: i64,
    pub satiety: u32,
    pub inventory: BTreeMap<ItemId, u32>,
    pub placed: Vec<ItemId>,
    pub shop: BTreeMap<ItemId, Product>,
    pub unread: u32,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Letter {
    pub id: i64,
    pub note: String,
    pub delta: i64,
    pub opened: u8,
}
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Mail {
    pub letters: Vec<Letter>,
    pub next_before: Option<i64>,
}
#[derive(Clone, Copy, PartialEq, Serialize, Deserialize, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Act {
    Pet,
    Buy,
    Feed,
    Place,
    OpenLetter,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Action {
    pub kind: Act,
    pub item: Option<ItemId>,
    #[serde(default)]
    pub placed: Option<bool>,
    pub request_id: Uuid,
    pub letter: Option<i64>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Savings {
    #[serde(default = "default_name")]
    name: String,
    balance: i64,
    stock: BTreeMap<ItemId, u32>,
    placed: Vec<ItemId>,
    satiety: u32,
    fed: u64,
    pet_day: Option<u64>,
    earning_day: u64,
    seconds: u32,
    receipts: VecDeque<Action>,
}
impl Default for Savings {
    fn default() -> Self {
        Self {
            name: default_name(),
            balance: 6,
            stock: [(ItemId("hay".into()), 2), (ItemId("carrot".into()), 1)].into(),
            placed: vec![],
            satiety: 45,
            fed: 0,
            pet_day: None,
            earning_day: 0,
            seconds: 0,
            receipts: VecDeque::new(),
        }
    }
}
#[derive(Default, Clone, Serialize, Deserialize)]
struct Disk {
    settings: Settings,
    rabbit: Savings,
}
pub struct Store {
    root: PathBuf,
    disk: Disk,
    _owner: File,
    observed: u64,
}
impl Store {
    pub fn open(root: &Path, clock: u64) -> Result<Self> {
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let owner = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join("instance.lock"))
            .map_err(|e| e.to_string())?;
        owner
            .try_lock()
            .map_err(|_| "这个兔窝已经打开，或存档目录无法加锁。".to_string())?;
        let disk = match fs::read(root.join("nest.json")) {
            Ok(v) => {
                let raw: serde_json::Value = serde_json::from_slice(&v)
                    .map_err(|_| "存档无法读取，原文件已保留。".to_owned())?;
                let legacy_layer = raw["settings"].get("wallpaper_above_icons").is_none();
                let mut disk: Disk = serde_json::from_value(raw)
                    .map_err(|_| "存档无法读取，原文件已保留。".to_owned())?;
                if legacy_layer {
                    // Before 0.2.2 the background was rendered only by the desktop rabbit.
                    disk.settings.wallpaper = disk.settings.mode == Mode::Desktop && disk.settings.scene != "clear";
                }
                disk
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => Disk::default(),
            Err(e) => return Err(e.to_string()),
        };
        Ok(Self {
            root: root.into(),
            disk,
            _owner: owner,
            observed: clock,
        })
    }
    fn commit(&mut self, d: Disk) -> Result<()> {
        let mut f = tempfile::NamedTempFile::new_in(&self.root).map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec_pretty(&d).map_err(|e| e.to_string())?;
        f.write_all(&bytes)
            .and_then(|_| f.as_file().sync_all())
            .map_err(|e| e.to_string())?;
        f.persist(self.root.join("nest.json"))
            .map_err(|e| e.to_string())?;
        self.disk = d;
        Ok(())
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn settings(&self) -> Settings {
        self.disk.settings.clone()
    }
    pub fn atmosphere(&self) -> &str {
        &self.disk.settings.atmosphere
    }
    pub fn configure(&mut self, change: impl FnOnce(&mut Settings)) -> Result<()> {
        let mut d = self.disk.clone();
        change(&mut d.settings);
        self.commit(d)
    }
    pub fn clock(&mut self, clock: u64, t: u64, unlocked: bool) -> Result<()> {
        let gap = clock.saturating_sub(self.observed);
        if !unlocked || self.disk.settings.cloud || gap == 0 || gap > 150 {
            self.observed = clock;
            return Ok(());
        }
        let mut d = self.disk.clone();
        let mut start = t.saturating_sub(gap);
        while start < t {
            let today = day(start);
            let end = t.min((today + 1) * 86400 - 9 * 3600);
            let s = &mut d.rabbit;
            if today > s.earning_day {
                s.earning_day = today;
                s.seconds = 0;
            }
            if today == s.earning_day {
                let old = s.seconds;
                s.seconds = (old + (end - start) as u32).min(12 * 300);
                s.balance += i64::from(s.seconds / 300 - old / 300);
            }
            start = end;
        }
        if d.rabbit.earning_day != self.disk.rabbit.earning_day
            || d.rabbit.seconds != self.disk.rabbit.seconds
            || d.rabbit.balance != self.disk.rabbit.balance
        {
            self.commit(d)?;
        }
        self.observed = clock;
        Ok(())
    }
    pub fn placed(&self) -> &[ItemId] {
        &self.disk.rabbit.placed
    }
    pub fn name(&self) -> &str {
        &self.disk.rabbit.name
    }
    pub fn rename(&mut self, raw: &str) -> Result<String> {
        let name = checked_name(raw)?;
        if self.name() != name {
            let mut d = self.disk.clone();
            d.rabbit.name = name.to_owned();
            self.commit(d)?;
        }
        Ok(name.to_owned())
    }
    pub fn home(&self, t: u64) -> Home {
        let s = &self.disk.rabbit;
        Home {
            name: s.name.clone(),
            atmosphere: self.disk.settings.atmosphere.clone(),
            balance: s.balance,
            satiety: fullness(s, t),
            inventory: s.stock.clone(),
            placed: s.placed.clone(),
            shop: catalog(),
            unread: 0,
        }
    }
    pub fn act(&mut self, a: &Action, t: u64) -> Result<()> {
        let mut d = self.disk.clone();
        let s = &mut d.rabbit;
        if let Some(prev) = s.receipts.iter().find(|r| r.request_id == a.request_id) {
            return if prev == a {
                Ok(())
            } else {
                Err("操作编号冲突".into())
            };
        }
        match a.kind {
            Act::Pet => {
                if s.pet_day.is_some_and(|v| v >= day(t)) {
                    return Ok(());
                }
                s.pet_day = Some(day(t));
                s.balance += 1;
            }
            Act::OpenLetter => return Err("本机没有这封信".into()),
            _ => {
                let i = a.item.clone().ok_or("请选择物品")?;
                let catalog = catalog();
                let p = catalog.get(&i).ok_or("商品未上架")?;
                let qty = *s.stock.get(&i).unwrap_or(&0);
                match a.kind {
                    Act::Buy => {
                        if s.balance < p.price {
                            return Err("小橡果还不够".into());
                        }
                        if p.nourishment == 0 && qty > 0 {
                            return Err("兔窝里已经有了".into());
                        }
                        s.balance -= p.price;
                        s.stock.insert(i, qty + 1);
                    }
                    Act::Feed => {
                        if p.nourishment == 0 || qty == 0 {
                            return Err("篮子里没有这份食物".into());
                        }
                        let full = fullness(s, t);
                        if full >= 100 || t < s.fed + 3 {
                            return Err("让它先嚼完这一口吧".into());
                        }
                        s.satiety = (full + p.nourishment).min(100);
                        s.fed = t;
                        s.stock.insert(i, qty - 1);
                    }
                    Act::Place => {
                        if p.nourishment != 0 || qty == 0 {
                            return Err("先把这件摆设带回家".into());
                        }
                        s.placed.retain(|other| {
                            other != &i
                                && !(a.placed.unwrap_or(true)
                                    && p.slot.is_some()
                                    && catalog.get(other).is_some_and(|v| v.slot == p.slot))
                        });
                        if a.placed.unwrap_or(true) {
                            s.placed.push(i);
                        }
                    }
                    _ => unreachable!(),
                }
            }
        }
        s.receipts.push_back(a.clone());

        self.commit(d)
    }
}
fn fullness(s: &Savings, t: u64) -> u32 {
    if s.fed == 0 {
        s.satiety
    } else {
        s.satiety
            .saturating_sub((t.saturating_sub(s.fed) / 3600).min(100) as u32)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrate_wallpaper_from_the_previous_combined_desktop_mode() {
        for (mode, scene, behind, expected) in [
            (Mode::Overlay, "snow-forest", true, false),
            (Mode::Desktop, "snow-forest", false, true),
            (Mode::Desktop, "clear", true, false),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let mut old = serde_json::to_value(Disk::default()).unwrap();
            let settings = old["settings"].as_object_mut().unwrap();
            settings.remove("wallpaper_above_icons");
            settings.insert("mode".into(), serde_json::to_value(mode).unwrap());
            settings.insert("scene".into(), scene.into());
            settings.insert("wallpaper".into(), behind.into());
            fs::write(dir.path().join("nest.json"), serde_json::to_vec(&old).unwrap()).unwrap();
            let store = Store::open(dir.path(), 0).unwrap();
            assert_eq!(store.settings().wallpaper, expected);
            assert!(!store.settings().wallpaper_above_icons);
            assert_eq!(store.settings().mode, mode);
        }
    }
    #[test]
    fn catalog_override_and_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("catalog.json");
        std::fs::write(&p, r#"{"mint":{"name":"薄荷","price":5,"nourishment":3}}"#).unwrap();
        assert!(load_catalog(Some(&p)).contains_key(&ItemId("mint".into())));
        std::fs::write(&p, "{").unwrap();
        assert!(load_catalog(Some(&p)).contains_key(&ItemId("hay".into())));
    }
    #[test]
    fn legacy_inventory_and_nest_slots() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path(), 0).unwrap();
        let mut old = serde_json::to_value(&s.disk).unwrap();
        old["rabbit"]["stock"] =
            serde_json::json!({"hay":2,"bed":1,"ball":1,"toastbed":1,"knitbed":1});
        old["rabbit"]["placed"] = serde_json::json!(["ball", "bed"]);
        drop(s);
        std::fs::write(
            dir.path().join("nest.json"),
            serde_json::to_vec(&old).unwrap(),
        )
        .unwrap();
        s = Store::open(dir.path(), 0).unwrap();
        for (id, on) in [
            ("toastbed", None),
            ("knitbed", Some(true)),
            ("knitbed", Some(false)),
        ] {
            s.act(
                &Action {
                    kind: Act::Place,
                    item: Some(ItemId(id.into())),
                    request_id: Uuid::new_v4(),
                    placed: on,
                    letter: None,
                },
                100,
            )
            .unwrap();
            let items = s.placed().iter().map(|i| i.0.as_str()).collect::<Vec<_>>();
            assert_eq!(
                items,
                if on == Some(false) {
                    vec!["ball"]
                } else {
                    vec!["ball", id]
                }
            );
        }
        assert!(serde_json::from_str::<ItemId>(r#""../bad""#).is_err());
    }
    #[test]
    fn restart_retry_and_cap() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path(), 0).unwrap();
        let t = 2_000_000_000;
        for n in 1..=80 {
            s.clock(n * 60, t + n * 60, true).unwrap();
        }
        assert_eq!(s.home(t).balance, 18);
        let a = Action {
            kind: Act::Buy,
            item: Some(ItemId("carrot".into())),
            placed: None,
            request_id: Uuid::new_v4(),
            letter: None,
        };
        s.act(&a, t).unwrap();
        drop(s);
        let mut s = Store::open(dir.path(), 9000).unwrap();
        s.act(&a, t).unwrap();
        assert_eq!(s.home(t).balance, 15);
        assert_eq!(s.home(t).inventory[&ItemId("carrot".into())], 2);
        assert!(Store::open(dir.path(), 0).is_err());
    }
    #[test]
    fn no_cloud_or_sleep_credit() {
        let d = tempfile::tempdir().unwrap();
        let mut s = Store::open(d.path(), 0).unwrap();
        s.clock(5000, 10000, true).unwrap();
        s.configure(|p| p.cloud = true).unwrap();
        for i in 1..=10 {
            s.clock(5000 + i * 60, 10000 + i * 60, true).unwrap();
        }
        assert_eq!(s.home(10000).balance, 6);
    }
    #[test]
    fn names_round_trip_and_old_nests_keep_their_savings() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path(), 0).unwrap();
        let name = "🐇".repeat(12);
        assert_eq!(store.rename(&format!("  {name}  ")).unwrap(), name);
        assert!(store.rename(&(name.clone() + "兔")).is_err());
        for bad in [" ", "兔\n兔", "兔\u{7f}兔", "兔\u{2028}兔"] {
            assert!(store.rename(bad).is_err());
        }
        assert_eq!(store.home(0).name, name);
        drop(store);
        let path = dir.path().join("nest.json");
        let mut disk: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(disk["rabbit"]["name"], name);
        disk["rabbit"].as_object_mut().unwrap().remove("name");
        disk["rabbit"]["balance"] = 91.into();
        fs::write(&path, serde_json::to_vec(&disk).unwrap()).unwrap();
        let mut old = Store::open(dir.path(), 0).unwrap();
        assert_eq!(old.name(), "焦糖兔");
        old.rename(" 饭团 ").unwrap();
        drop(old);
        let reopened = Store::open(dir.path(), 0).unwrap().home(0);
        assert_eq!((reopened.name.as_str(), reopened.balance), ("饭团", 91));
        let mut shared = serde_json::to_value(&reopened).unwrap();
        shared["name"] = "团团".into();
        assert_eq!(
            serde_json::from_value::<Home>(shared.clone()).unwrap().name,
            "团团"
        );
        shared.as_object_mut().unwrap().remove("name");
        assert_eq!(
            serde_json::from_value::<Home>(shared).unwrap().name,
            "焦糖兔"
        );
    }
}
