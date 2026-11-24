use crate::store::{Mode, Result};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::mpsc::Sender};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Shortcut {
    Toggle,
    Switch,
}
impl Shortcut {
    pub fn dispatch(self, tx: &Sender<NativeEvent>) {
        static LAST: std::sync::Mutex<[Option<Instant>; 2]> = std::sync::Mutex::new([None; 2]);
        let mut last = LAST.lock().expect("shortcut clock");
        let now = Instant::now();
        let slot = &mut last[self as usize];
        if slot.is_some_and(|prev| now.duration_since(prev) < Duration::from_millis(180)) {
            return;
        }
        *slot = Some(now);
        let _ = tx.send(match self {
            Self::Toggle => NativeEvent::Toggle,
            Self::Switch => NativeEvent::Switch,
        });
    }
}
#[derive(Clone, Copy, Serialize, Default, Debug, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}
#[derive(Clone, Copy, Serialize, Default, Debug, PartialEq)]
pub struct Display {
    pub screen: Rect,
    pub work: Rect,
}
#[derive(Clone, Deserialize)]
pub struct Hit {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub rows: Vec<[i32; 4]>,
}
#[derive(Clone, Copy, Debug)]
pub enum NativeEvent {
    ExitPlay,
    Toggle,
    Switch,
    Foreground,
    Display,
    Click(i32, i32),
    Ground(i32, i32),
    Hover(i32, i32),
    Card(i32, i32),
    DragStart(i32, i32),
    Drag(i32, i32),
    Drop,
    Lock(bool),
    Tick,
}
pub trait PlatformController: Send + Sync {
    fn set_ground_input(&self, enabled: bool, walk: bool);
    fn furnishings(&self, window: isize, display: Display, visible: bool, anchor: isize);
    fn install(events: Sender<NativeEvent>) -> Result<Self>
    where
        Self: Sized;
    fn display(&self, stage: isize) -> Display;
    #[allow(dead_code)]
    fn is_desktop(&self, stage: isize, card: isize) -> bool;
    fn foreground_external(&self, stage: isize, card: isize) -> bool;
    #[allow(clippy::too_many_arguments)]
    fn wallpaper(&self, window: isize, display: Display, visible: bool, above_icons: bool) -> bool;
    fn present(
        &self,
        stage: isize,
        display: Display,
        mode: Mode,
        desktop_anchor: isize,
        visible: bool,
        interactive: bool,
        topmost: bool,
    );
    fn shape(&self, stage: isize, hit: &Hit, top: bool);
    fn hide_hit(&self);
    fn card_position(&self, card: isize, x: i32, y: i32, display: Display);
    fn open_scenes(&self, path: &Path) -> Result<()>;
    fn shortcuts(&self) -> [Option<String>; 2];
    fn hide_card(&self, window: isize);
}
#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(test, target_os = "macos"))]
mod retina;
#[cfg(all(target_os = "macos", feature = "cloud-sync"))]
pub use macos::credentials;
#[cfg(target_os = "macos")]
pub use macos::{awake_seconds, cursor_pos, file_path, handle, startup_error, Native};
#[cfg(windows)]
mod windows;
#[cfg(all(windows, feature = "cloud-sync"))]
pub use windows::credentials;
#[cfg(windows)]
pub use windows::{awake_seconds, capture_desktop, cursor_pos, file_path, Native};
#[cfg(windows)]
pub use windows::{handle, startup_error};
