#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod album;
mod updater;
use updater::check_update;
#[cfg(feature = "cloud-sync")]
mod cloud;
#[cfg(not(feature = "cloud-sync"))]
#[path = "offline.rs"]
mod cloud;
mod platform;
mod scenes;
mod store;
use album::{AlbumPage, LocalAlbum, Photo, UploadMeta, Uploaded};
use cloud::Cloud;
use platform::{Display, Hit, Native, NativeEvent, PlatformController};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::Write,
    sync::{mpsc, Mutex},
};
use store::{
    checked_atmosphere, default_atmosphere, Act, Action, Fence, Home, Mail, Mode, Patrol, Result,
    Settings, Store,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
struct Runtime {
    store: Store,
    album: LocalAlbum,
    display: Display,
    stage_ready: bool,
    on_desktop: bool,
    visible: bool,
    selecting: bool,
    camera: bool,
    desktop_camera: bool,
    play_mode: bool,
    locked: bool,
    wall_active: bool,
    at_furniture: bool,
    card: bool,
    card_seq: u32,
    card_open: CardOpen,
    cloud_placed: Vec<store::ItemId>,
    cloud_name: String,
    cloud_atmosphere: String,
    revision: u32,
}
impl Runtime {
    fn name(&self) -> &str {
        if self.store.settings().cloud {
            &self.cloud_name
        } else {
            self.store.name()
        }
    }
    fn atmosphere(&self) -> &str {
        if self.store.settings().cloud {
            &self.cloud_atmosphere
        } else {
            self.store.atmosphere()
        }
    }
}
struct App {
    native: Native,
    shortcut_tx: mpsc::Sender<NativeEvent>,
    core: Mutex<Runtime>,
    root: scenes::Roots,
    cloud: Cloud,
    account: tokio::sync::Mutex<()>,
}
impl App {
    fn core(&self) -> std::sync::MutexGuard<'_, Runtime> {
        self.core.lock().expect("desktop state")
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct View {
    name: String,
    atmosphere: String,
    settings: Settings,
    display: Display,
    visible: bool,
    selecting: bool,
    camera: bool,
    desktop_camera: bool,
    play_mode: bool,
    wall_active: bool,
    at_furniture: bool,
    shortcuts: [Option<String>; 2],
    cloud_available: bool,
    placed: Vec<store::ItemId>,
    revision: u32,
    card_seq: u32,
    card_open: CardOpen,
}
fn view(a: &App) -> View {
    let c = a.core();
    View {
        name: c.name().to_owned(),
        atmosphere: c.atmosphere().to_owned(),
        settings: c.store.settings(),
        placed: if c.store.settings().cloud {
            c.cloud_placed.clone()
        } else {
            c.store.placed().to_vec()
        },
        display: c.display,
        visible: c.visible,
        selecting: c.selecting,
        camera: c.camera,
        desktop_camera: c.camera && c.desktop_camera,
        play_mode: c.play_mode,
        wall_active: c.wall_active,
        at_furniture: c.at_furniture,
        shortcuts: a.native.shortcuts(),
        cloud_available: cfg!(feature = "cloud-sync"),
        revision: c.revision,
        card_seq: c.card_seq,
        card_open: c.card_open.clone(),
    }
}
fn ui(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    app.get_webview_window(label)
}
fn hwnd(w: &WebviewWindow) -> isize {
    platform::handle(w)
}
fn sync(app: &AppHandle, force: bool) {
    let Some(stage) = ui(app, "stage") else {
        return;
    };
    let a = app.state::<App>();
    let card = ui(app, "card");
    let stage_hwnd = hwnd(&stage);
    let card_hwnd = card.as_ref().map(hwnd).unwrap_or(0);
    let ext = a.native.foreground_external(stage_hwnd, card_hwnd);
    let on_desktop = a.native.is_desktop(stage_hwnd, card_hwnd);
    let (mode, visible, show, interactive, topmost, paper, above_icons, display, conceal_card, ground_input, walk, separate_props) = {
        let mut c = a.core();
        let s = c.store.settings();
        if c.locked || s.mode == Mode::Hidden {
            c.selecting = false;
            c.camera = false;
            c.play_mode = false;
        }
        let interactive = c.selecting || c.camera;
        let visible = !c.locked && (c.selecting || c.camera || s.mode != Mode::Hidden);
        let placed = if s.cloud { !c.cloud_placed.is_empty() } else { !c.store.placed().is_empty() };
        if !placed || s.mode != Mode::Overlay || interactive || c.locked { c.at_furniture = false; }
        let topmost = interactive || (s.mode == Mode::Overlay && !c.at_furniture);
        let separate_props = placed && s.mode != Mode::Desktop && !interactive && !c.locked;
        let change = visible != c.visible || force || (s.mode == Mode::Desktop && c.on_desktop != on_desktop);
        c.on_desktop = on_desktop;
        let conceal_card = c.locked
            || (c.visible && !visible && ext)
            || c.selecting
            || c.camera;
        c.visible = visible;
        (
            s.mode,
            visible,
            change,
            interactive,
            topmost,
            s.wallpaper && !c.locked && c.stage_ready,
            s.wallpaper_above_icons,
            c.display,
            conceal_card,
            (c.play_mode || (s.mode == Mode::Overlay && separate_props)) && !interactive,
            c.play_mode,
            separate_props,
        )
    };
    a.native.set_ground_input(ground_input, walk);
    if !show {
        return;
    }
    if !visible || interactive {
        a.native.hide_hit();
    }
    if conceal_card {
        close_card(app);
    }
    // On Windows present() owns the HWND styles. A queued Tao style update can
    // otherwise restore the stage's original hidden window after present returns.
    #[cfg(not(windows))]
    let _ = stage.set_focusable(interactive);
    let wall = ui(app, "wallpaper");
    let active = wall.as_ref().is_some_and(|w| a.native.wallpaper(hwnd(w), display, paper, above_icons));
    let anchor = if active && above_icons { wall.as_ref().map(hwnd).unwrap_or(0) } else { 0 };
    let mut anchor = anchor;
    if let Some(w) = ui(app, "furnishings") {
        let props = hwnd(&w);
        a.native.furnishings(props, display, separate_props, anchor);
        if separate_props { anchor = props; }
    }
    a.native.present(stage_hwnd, display, mode, anchor, visible, interactive, topmost);
    a.core().wall_active = active;
    let v = view(&a);
    if let Some(w) = wall { let _ = w.emit_to("wallpaper", "desktop-view", &v); }
    let _ = stage.emit_to("stage", "desktop-view", &v);
    if let Some(w) = card {
        let _ = w.emit_to("card", "desktop-view", &v);
    }
}
fn apply_mode(app: &AppHandle, mode: Mode, close: bool) -> Result<()> {
    let a = app.state::<App>();
    {
        let mut c = a.core();
        c.store.configure(|s| {
            s.mode = mode;
            if mode != Mode::Hidden {
                s.last = mode;
            }
        })?;
        c.selecting = false;
        c.camera = false;
        c.play_mode = false;
    }
    if close {
        close_card(app);
    }
    a.native.hide_hit();
    sync(app, true);
    Ok(())
}
fn change_mode(app: &AppHandle, mode: Mode) -> Result<()> {
    apply_mode(app, mode, true)
}
fn build_window(app: &AppHandle, label: &str, file: &str) -> tauri::Result<WebviewWindow> {
    let stage = label == "stage";
    let expected = if stage {
        "/".to_owned()
    } else {
        format!("/{file}")
    };
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(file.into()));
    #[cfg(windows)]
    let builder = builder
        .transparent(true)
        .background_color(tauri::webview::Color(0, 0, 0, 0));
    builder
        .title(if label == "furnishings" { "FUTARI Furnishings".into() } else if label == "wallpaper" { "FUTARI Wallpaper".into() } else { format!("FUTARI · {}", app.state::<App>().core().name()) })
        .inner_size(
            if stage { 200. } else { 420. },
            if stage { 160. } else { 540. },
        )
        .visible(false)
        .focused(false)
        .focusable(label == "card")
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .disable_drag_drop_handler()
        .devtools(false)
        .on_navigation(move |u| {
            let local = if cfg!(target_os = "macos") {
                u.scheme() == "tauri" && u.host_str() == Some("localhost")
            } else {
                u.scheme() == "http" && u.host_str() == Some("tauri.localhost")
            };
            local
                && u.port().is_none()
                && u.path() == expected
                && u.query().is_none()
                && u.fragment().is_none()
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
}
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct CardOpen {
    tab: Option<String>,
    notice: Option<String>,
}
fn close_card(app: &AppHandle) {
    let a = app.state::<App>();
    a.core().card = false;
    if let Some(w) = ui(app, "card") {
        a.native.hide_card(hwnd(&w));
        let _ = w.emit_to("card", "card-closed", ());
    }
}
#[tauri::command]
async fn close_notebook(app: AppHandle) {
    close_card(&app);
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CardOpenEvent {
    seq: u32,
    tab: Option<String>,
    notice: Option<String>,
}
fn show_card(app: &AppHandle, anchor: Option<(i32, i32)>, payload: CardOpen) -> Result<()> {
    let a = app.state::<App>();
    let d = a.core().display;
    let event = {
        let mut c = a.core();
        c.card_seq = c.card_seq.wrapping_add(1).max(1);
        c.card_open = payload.clone();
        CardOpenEvent {
            seq: c.card_seq,
            tab: payload.tab,
            notice: payload.notice,
        }
    };
    let (x, y) = anchor.unwrap_or((d.work.x + d.work.w - 22, d.work.y + d.work.h - 12));
    if let Some(w) = ui(app, "card") {
        a.core().card = true;
        a.native.card_position(hwnd(&w), x, y, d);
        let _ = w.emit_to("card", "card-open", &event);
        return Ok(());
    }
    {
        let mut c = a.core();
        if c.card {
            return Ok(());
        }
        c.card = true;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        let w = match build_window(&handle, "card", "card.html") {
            Ok(w) => w,
            Err(_) => {
                handle.state::<App>().core().card = false;
                return;
            }
        };
        let for_close = handle.clone();
        w.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                close_card(&for_close);
            }
        });
        let h = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            let a = h.state::<App>();
            if !a.core().card {
                return;
            }
            a.native.card_position(hwnd(&w), x, y, d);
            let _ = w.emit_to("card", "card-open", &event);
        });
    });
    Ok(())
}
fn tick(app: &AppHandle, lock: Option<bool>) {
    let a = app.state::<App>();
    let cloud = {
        let mut c = a.core();
        let unlocked = !c.locked;
        let _ = c
            .store
            .clock(platform::awake_seconds(), store::now(), unlocked);
        if let Some(v) = lock {
            c.locked = v;
        }
        c.store.settings().cloud && !c.locked
    };
    if lock.is_some() {
        sync(app, true);
    }
    if cloud {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let a = app.state::<App>();
            let Ok(_g) = a.account.try_lock() else {
                return;
            };
            if a.core().store.settings().cloud {
                if a.cloud.simple("pulse").await.is_ok() && !a.core().card {
                    let _ = refresh_cloud_home(&app, &a).await;
                }
            }
            let _ = app.emit_to("card", "wallet-update", ());
        });
    } else if a.core().card {
        let _ = app.emit_to("card", "wallet-update", ());
    }
}
fn visual(app: &AppHandle, v: &str) {
    let _ = app.emit_to("stage", "gesture", v);
}
fn toggle_step(mode: Mode) -> Mode {
    match mode {
        Mode::Hidden => Mode::Desktop,
        Mode::Desktop => Mode::Overlay,
        Mode::Overlay => Mode::Hidden,
    }
}
fn set_wallpaper(cfg: &mut Settings, enabled: bool) {
    cfg.wallpaper = enabled;
    if enabled && cfg.scene == "clear" {
        cfg.scene = "snow-forest".into();
    }
}
fn event(app: &AppHandle, e: NativeEvent) {
    let a = app.state::<App>();
    match e {
        NativeEvent::Toggle => {
            let next = toggle_step(a.core().store.settings().mode);
            let _ = apply_mode(app, next, next == Mode::Hidden);
        }
        NativeEvent::Switch => {
            {
                let mut c = a.core();
                let enabled = !c.store.settings().wallpaper;
                let _ = c.store.configure(|cfg| set_wallpaper(cfg, enabled));
            }
            sync(app, true);
        }
        NativeEvent::ExitPlay => {
            a.core().play_mode = false;
            sync(app, true);
        }
        NativeEvent::Foreground => sync(app, false),
        NativeEvent::Display => {
            if let Some(w) = ui(app, "stage") {
                let d = a.native.display(hwnd(&w));
                a.core().display = d;
                sync(app, true);
            }
        }
        NativeEvent::Card(x, y) => {
            let _ = show_card(app, Some((x, y)), CardOpen::default());
        }
        NativeEvent::Ground(x, y) => {
            let c = a.core();
            let r = c.display.work;
            if c.visible && (c.play_mode || c.store.settings().mode == Mode::Overlay) && !c.camera && !c.selecting
                && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h {
                let origin = c.display.screen;
                drop(c);
                let _ = app.emit_to("stage", "desktop-ground", [x - origin.x, y - origin.y]);
            }
        }
        NativeEvent::Click(x, y) => {
            if !a.core().visible {
                return;
            }
            let d = a.core().display;
            let _ = app.emit_to("stage", "stage-click", [x - d.screen.x, y - d.screen.y]);
        }
        NativeEvent::Hover(x, y) => {
            if !a.core().visible {
                return;
            }
            let d = a.core().display;
            let _ = app.emit_to("stage", "stage-hover", [x - d.screen.x, y - d.screen.y]);
        }
        NativeEvent::DragStart(x, y) => {
            let d = a.core().display;
            let _ = app.emit_to("stage", "drag-start", [x - d.screen.x, y - d.screen.y]);
        }
        NativeEvent::Drag(x, y) => {
            let d = a.core().display;
            let _ = app.emit_to("stage", "drag-pet", [x - d.screen.x, y - d.screen.y]);
        }
        NativeEvent::Drop => visual(app, "drop"),
        NativeEvent::Lock(v) => tick(app, Some(v)),
        NativeEvent::Tick => tick(app, None),
    }
}
#[tauri::command]
fn focused_shortcut(app: AppHandle, key: platform::Shortcut) {
    key.dispatch(&app.state::<App>().shortcut_tx);
}
#[tauri::command]
fn capture_desktop(app: AppHandle, window: WebviewWindow, crop: [f64; 4]) -> Result<tauri::ipc::Response> {
    let state = app.state::<App>();
    let c = state.core();
    if window.label() != "stage" || !c.camera || !c.desktop_camera || !c.visible || c.locked {
        return Err("请先打开桌面相机".into());
    }
    drop(c);
    #[cfg(windows)]
    return platform::capture_desktop(hwnd(&window), crop).map(tauri::ipc::Response::new);
    #[cfg(not(windows))]
    {
        let _ = crop;
        Err("当前平台使用场景相机".into())
    }
}
#[tauri::command]
fn desktop_view(app: AppHandle, window: WebviewWindow) -> View {
    let a = app.state::<App>();
    let first = if window.label() == "stage" {
        let mut c = a.core();
        if c.stage_ready {
            false
        } else {
            c.stage_ready = true;
            true
        }
    } else {
        false
    };
    if first {
        sync(&app, true);
    }
    view(&a)
}
#[tauri::command]
fn furniture_contact(app: AppHandle, touching: bool) {
    let a = app.state::<App>();
    {
        let mut c = a.core();
        if c.store.settings().mode != Mode::Overlay || c.camera || c.selecting || c.at_furniture == touching { return; }
        c.at_furniture = touching;
    }
    sync(&app, true);
}
#[tauri::command]
fn update_hit(app: AppHandle, hit: Hit) -> Result<()> {
    let a = app.state::<App>();
    let c = a.core();
    if !c.visible || c.selecting || c.camera {
        return Ok(());
    }
    if hit.w < 1
        || hit.h < 1
        || hit.w > 4096
        || hit.h > 4096
        || hit.x.abs_diff(0) > 32768
        || hit.y.abs_diff(0) > 32768
        || hit.rows.len() > 8192
        || hit
            .rows
            .iter()
            .any(|[x, y, r, b]| *x < 0 || *y < 0 || r <= x || b <= y || *r > hit.w || *b > hit.h)
    {
        return Err("无效的命中区域".into());
    }
    let top = c.store.settings().mode == Mode::Overlay && !c.at_furniture;
    drop(c);
    if let Some(w) = ui(&app, "stage") {
        a.native.shape(hwnd(&w), &hit, top);
    }
    Ok(())
}
#[tauri::command]
fn report_scene(app: AppHandle, message: String) {
    let _ = app.emit_to(
        "card",
        "scene-error",
        message.chars().take(120).collect::<String>(),
    );
}
#[tauri::command]
fn scene_list(app: AppHandle) -> Result<Vec<scenes::Pack>> {
    app.state::<App>().root.list()
}
#[tauri::command]
async fn scene_layer(
    app: AppHandle,
    id: String,
    layer: scenes::Layer,
) -> Result<tauri::ipc::Response> {
    let root = app.state::<App>().root.clone();
    let data = tauri::async_runtime::spawn_blocking(move || root.layer(&id, layer))
        .await
        .map_err(|_| "图片读取中断")??;
    Ok(tauri::ipc::Response::new(data))
}
#[derive(Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
enum Setting {
    Mode(Mode),
    WallpaperAboveIcons(bool),
    AutoRest(bool),
    RabbitScale(u16),
    PropScale(u16),
    Patrol(Patrol),
    Scene(String),
    Wallpaper(bool),
    PlayMode(bool),
    Gesture(String),
    SelectFence,
    Close,
    Folder,
    Refresh,
}
#[tauri::command]
fn set_option(app: AppHandle, option: Setting) -> Result<()> {
    let a = app.state::<App>();
    match option {
        Setting::Mode(m) => return apply_mode(&app, m, m == Mode::Hidden),
        Setting::WallpaperAboveIcons(v) => a.core().store.configure(|s| s.wallpaper_above_icons = v)?,
        Setting::RabbitScale(v) | Setting::PropScale(v) => {
            if !(50..=200).contains(&v) { return Err("大小应在 50% 到 200% 之间".into()); }
            a.core().store.configure(|s| match option {
                Setting::RabbitScale(_) => s.rabbit_scale = v,
                _ => s.prop_scale = v,
            })?;
        }
        Setting::AutoRest(v) => a.core().store.configure(|s| s.auto_rest = v)?,
        Setting::Close => {
            close_card(&app);
            return Ok(());
        }
        Setting::Folder => {
            a.root.list()?;
            return a.native.open_scenes(&a.root.user);
        }
        Setting::Refresh => {
            a.root.list()?;
            let mut c = a.core();
            c.revision = c.revision.wrapping_add(1);
        }
        Setting::SelectFence => {
            change_mode(&app, Mode::Overlay)?;
            a.core().selecting = true;
        }
        Setting::PlayMode(v) => {
            {
                let mut c = a.core();
                if v {
                    if c.store.settings().mode == Mode::Hidden {
                        return Err("先显示小兔，再开启点地移动".into());
                    }
                    c.selecting = false;
                    c.camera = false;
                }
                c.play_mode = v;
            }
            sync(&app, true);
            if v {
                close_card(&app);
            }
            return Ok(());
        }
        Setting::Gesture(key) => {
            const ALLOWED: &[&str] = &[
                "pet", "stand", "alert", "groom", "tilt", "sniff", "listen",
                "peek", "back", "loaf", "sploot", "flop", "stretch",
                "tunnel", "ball", "bed", "bowl",
            ];
            if !ALLOWED.contains(&key.as_str()) {
                return Err("没有这个动作".into());
            }
            if a.core().store.settings().mode == Mode::Hidden {
                return Err("小兔现在处于隐身状态，先切回桌面或陪工模式吧".into());
            }
            visual(&app, &key);
            return Ok(());
        }
        Setting::Wallpaper(v) => a.core().store.configure(|s| set_wallpaper(s, v))?,
        Setting::Patrol(p) => {
            if p == Patrol::Custom && a.core().store.settings().fence.is_none() {
                return Err("先划定活动区".into());
            }
            a.core().store.configure(|s| s.patrol = p)?;
        }
        Setting::Scene(id) => {
            if id != "clear" && id != "paper" {
                a.root.manifest(&id)?;
            }
            let mut c = a.core();
            c.store.configure(|s| {
                s.wallpaper = id != "clear";
                if s.wallpaper { s.scene = id; }
            })?;
        }
    }
    sync(&app, true);
    Ok(())
}
#[tauri::command]
fn finish_fence(app: AppHandle, fence: Option<Fence>) -> Result<()> {
    let a = app.state::<App>();
    {
        let mut c = a.core();
        if !c.selecting {
            return Err("当前没有框选".into());
        }
        if let Some(f) = fence {
            if !f.valid() {
                return Err("请画大一点".into());
            }
            c.store.configure(|s| {
                s.fence = Some(f);
                s.patrol = Patrol::Custom;
            })?;
        }
        c.selecting = false;
    }
    sync(&app, true);
    Ok(())
}
async fn apply_action(app: &AppHandle, a: &Action, emit_visual: bool) -> Result<()> {
    let state = app.state::<App>();
    let _guard = state.account.lock().await;
    let online = state.core().store.settings().cloud;
    if online {
        state.cloud.act(a).await?
    } else {
        state.core().store.act(a, store::now())?;
    }
    if a.kind == Act::Place {
        if online {
            let updated = state.cloud.home().await?;
            state.core().cloud_placed = updated.placed;
        }
        sync(app, true);
    }
    if emit_visual && a.kind == Act::Feed {
        if let Some(item) = &a.item { visual(app, &format!("feed:{}",item.0)); }
    }
    let _ = app.emit_to("card", "wallet-update", ());
    Ok(())
}
#[tauri::command]
async fn tend(app: AppHandle, action: Action) -> Result<()> {
    apply_action(&app, &action, true).await
}
#[derive(Serialize)]
struct StageActReply {
    fed: Option<store::ItemId>,
}
#[tauri::command]
async fn stage_act(
    app: AppHandle,
    kind: String,
    item: Option<store::ItemId>,
) -> Result<StageActReply> {
    match kind.as_str() {
        "pet" => {
            let action = Action {
                kind: Act::Pet,
                item: None,
                request_id: uuid::Uuid::new_v4(),
                letter: None,
                placed: None,
            };
            apply_action(&app, &action, false).await?;
            Ok(StageActReply { fed: None })
        }
        "feed" => {
            let food = item.ok_or("请选择食物")?;
            let action = Action {
                kind: Act::Feed,
                item: Some(food.clone()),
                request_id: uuid::Uuid::new_v4(),
                letter: None,
                placed: None,
            };
            apply_action(&app, &action, false).await?;
            close_card(&app);
            Ok(StageActReply { fed: Some(food) })
        }
        "bowl" => {
            let state = app.state::<App>();
            let (meal, online) = {
                let _guard = state.account.lock().await;
                let online = state.core().store.settings().cloud;
                let home = if online {
                    state.cloud.home().await?
                } else {
                    state.core().store.home(store::now())
                };
                let pick = |candidate: &store::ItemId| {
                    home.shop.get(candidate).is_some_and(|p| p.nourishment > 0)
                        && home.inventory.get(candidate).copied().unwrap_or(0) > 0
                };
                let meal = item.filter(&pick).or_else(|| home.shop.keys().find(|it| pick(it)).cloned());
                if let Some(food) = &meal {
                    let action = Action {
                        kind: Act::Feed,
                        item: Some(food.clone()),
                        request_id: uuid::Uuid::new_v4(),
                        letter: None,
                placed: None,
                    };
                    if online {
                        state.cloud.act(&action).await?;
                    } else {
                        state.core().store.act(&action, store::now())?;
                    }
                }
                (meal, online)
            };
            if meal.is_none() {
                let _ = show_card(
                    &app,
                    None,
                    CardOpen {
                        tab: Some("shop".into()),
                        notice: Some("蓝碗空着，挑一份草吧。".into()),
                    },
                );
                return Ok(StageActReply { fed: None });
            }
            let _ = app.emit_to("card", "wallet-update", ());
            let _ = online;
            Ok(StageActReply { fed: meal })
        }
        _ => Err("不支持这个动作".into()),
    }
}
#[tauri::command]
fn exit_stage_mode(app: AppHandle, mode: String) -> Result<()> {
    let a = app.state::<App>();
    {
        let mut c = a.core();
        match mode.as_str() {
            "play" => c.play_mode = false,
            "camera" => c.camera = false,
            _ => return Err("无效的模式".into()),
        }
    }
    sync(&app, true);
    Ok(())
}
#[tauri::command]
fn open_card(app: AppHandle, tab: Option<String>, notice: Option<String>) -> Result<()> {
    show_card(&app, None, CardOpen { tab, notice })
}
#[derive(Clone, Serialize)]
struct FoodDragEvent {
    phase: String,
    item: Option<store::ItemId>,
    x: i32,
    y: i32,
}
#[tauri::command]
fn food_drag(app: AppHandle, phase: String, item: Option<store::ItemId>) -> Result<()> {
    if !matches!(phase.as_str(), "start" | "move" | "end" | "cancel") {
        return Err("拖拽状态无效".into());
    }
    if matches!(phase.as_str(), "start" | "move" | "end")
        && !item.as_ref().is_some_and(|i| store::catalog().get(i).is_some_and(|p| p.nourishment > 0))
    {
        return Err("请选择食物".into());
    }
    let (cx, cy) = platform::cursor_pos();
    let d = app.state::<App>().core().display;
    let _ = app.emit_to(
        "stage",
        "food-drag",
        FoodDragEvent {
            phase,
            item,
            x: cx - d.screen.x,
            y: cy - d.screen.y,
        },
    );
    Ok(())
}
#[tauri::command]
async fn set_atmosphere(app: AppHandle, atmosphere: String) -> Result<String> {
    let valid = checked_atmosphere(&atmosphere)?.to_owned();
    let state = app.state::<App>();
    {
        let _guard = state.account.lock().await;
        let online = state.core().store.settings().cloud;
        if online {
            let saved = state.cloud.set_atmosphere(&valid).await?;
            state.core().cloud_atmosphere = saved;
        } else {
            state
                .core()
                .store
                .configure(|s| s.atmosphere = valid.clone())?;
        }
    }
    sync(&app, true);
    let _ = app.emit_to("card", "wallet-update", ());
    Ok(valid)
}
#[derive(Clone, Serialize)]
struct CameraOpen {
    moment: Option<String>,
}
async fn open_camera_mode(app: &AppHandle, moment: Option<String>) -> Result<()> {
    if let Some(ref m) = moment {
        album::checked_moment(m)?;
    }
    let state = app.state::<App>();
    let needs_snow = matches!(moment.as_deref(), Some("stump" | "nap"));
    let needs_night = matches!(moment.as_deref(), Some("nap"));
    if needs_night {
        let _guard = state.account.lock().await;
        let online = state.core().store.settings().cloud;
        if online {
            let saved = state.cloud.set_atmosphere("night").await?;
            state.core().cloud_atmosphere = saved;
        } else {
            state
                .core()
                .store
                .configure(|s| s.atmosphere = "night".into())?;
        }
    }
    {
        let mut c = state.core();
        let s = c.store.settings();
        let restore = if s.mode == Mode::Hidden {
            Some(s.last)
        } else {
            None
        };
        if needs_snow {
            state.root.manifest("snow-forest")?;
        }
        if restore.is_some() || (needs_snow && s.scene != "snow-forest") {
            c.store.configure(|cfg| {
                if let Some(last) = restore {
                    cfg.mode = last;
                }
                if needs_snow {
                    cfg.scene = "snow-forest".into();
                }
            })?;
        }
        c.camera = true;
        c.desktop_camera = cfg!(windows) && moment.is_none();
        c.play_mode = false;
        c.selecting = false;
    }
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if !handle.state::<App>().core().camera {
            return;
        }
        close_card(&handle);
        sync(&handle, true);
        let _ = handle.emit_to("stage", "camera-open", CameraOpen { moment });
    }).map_err(|e| e.to_string())
}
#[tauri::command]
async fn start_camera(app: AppHandle, moment: Option<String>) -> Result<()> {
    open_camera_mode(&app, moment).await
}
#[tauri::command]
async fn album_list(
    app: AppHandle,
    moment: Option<String>,
    before: Option<String>,
) -> Result<AlbumPage> {
    let a = app.state::<App>();
    let _guard = a.account.lock().await;
    if a.core().store.settings().cloud {
        a.cloud
            .album_list(moment.as_deref(), before.as_deref())
            .await
    } else {
        let c = a.core();
        c.album.list(c.name(), moment.as_deref(), before.as_deref())
    }
}
#[tauri::command]
async fn album_image(app: AppHandle, id: String) -> Result<tauri::ipc::Response> {
    let a = app.state::<App>();
    let _guard = a.account.lock().await;
    let bytes = if a.core().store.settings().cloud {
        a.cloud.album_image(&id).await?
    } else {
        a.core().album.image(&id)?
    };
    Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
async fn album_upload(app: AppHandle, meta: UploadMeta, image_base64: String) -> Result<Uploaded> {
    let bytes = album::decode_base64(&image_base64, 2_300_000)?;
    let a = app.state::<App>();
    let _guard = a.account.lock().await;
    if a.core().store.settings().cloud {
        a.cloud.album_upload(&meta, &bytes).await
    } else {
        a.core().album.upload(meta, &bytes)
    }
}
#[tauri::command]
async fn album_title(app: AppHandle, id: String, title: String, revision: i64) -> Result<Photo> {
    let a = app.state::<App>();
    let _guard = a.account.lock().await;
    if a.core().store.settings().cloud {
        a.cloud.album_title(&id, &title, revision).await
    } else {
        a.core().album.rename_title(&id, &title, revision)
    }
}
#[tauri::command]
async fn album_delete(app: AppHandle, id: String, revision: i64) -> Result<()> {
    let a = app.state::<App>();
    let _guard = a.account.lock().await;
    if a.core().store.settings().cloud {
        a.cloud.album_delete(&id, revision).await
    } else {
        a.core().album.delete(&id, revision)
    }
}
#[tauri::command]
async fn save_print(app: AppHandle, filename: String, image_base64: String) -> Result<String> {
    let bytes = album::decode_base64(&image_base64, 6_000_000)?;
    album::validate_print_png(&bytes)?;
    let clean = album::sanitize_png_filename(&filename)?;
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().desktop_dir())
        .map_err(|_| "找不到下载文件夹")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = clean.strip_suffix(".png").unwrap_or(&clean);
    for idx in 0..1000u32 {
        let candidate = if idx == 0 {
            clean.clone()
        } else {
            format!("{stem} ({idx}).png")
        };
        let path = dir.join(&candidate);
        match File::options().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(&bytes)
                    .and_then(|_| file.sync_all())
                    .map_err(|e| e.to_string())?;
                return Ok(candidate);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("下载文件夹同名文件过多".into())
}
#[tauri::command]
async fn home(app: AppHandle) -> Result<Home> {
    let a = app.state::<App>();
    let _guard = a.account.lock().await;
    if !a.core().store.settings().cloud {
        return Ok(a.core().store.home(store::now()));
    }
    refresh_cloud_home(&app, &a).await
}
async fn refresh_cloud_home(app: &AppHandle, a: &App) -> Result<Home> {
    let updated = a.cloud.home().await?;
    let mut dirty = false;
    {
        let mut c = a.core();
        if c.cloud_name != updated.name {
            c.cloud_name = updated.name.clone();
            dirty = true;
        }
        if c.cloud_placed != updated.placed {
            c.cloud_placed = updated.placed.clone();
            dirty = true;
        }
        if c.cloud_atmosphere != updated.atmosphere {
            c.cloud_atmosphere = updated.atmosphere.clone();
            dirty = true;
        }
    }
    if dirty {
        sync_name(app, a);
        sync(app, true);
    }
    Ok(updated)
}
fn sync_name(app: &AppHandle, a: &App) {
    let v = view(a);
    let title = format!("FUTARI · {}", v.name);
    if let Some(tray) = app.tray_by_id("nest") {
        let _ = tray.set_tooltip(Some(&title));
    }
    for label in ["stage", "card"] {
        if let Some(window) = ui(app, label) {
            let _ = window.set_title(&title);
        }
    }
    let _ = app.emit_to("card", "desktop-view", &v);
}
#[tauri::command]
async fn rename(app: AppHandle, name: String) -> Result<String> {
    let a = app.state::<App>();
    let _guard = a.account.lock().await;
    let online = a.core().store.settings().cloud;
    let saved = if online {
        let saved = a.cloud.rename(&name).await?;
        a.core().cloud_name = saved.clone();
        saved
    } else {
        a.core().store.rename(&name)?
    };
    sync_name(&app, &a);
    Ok(saved)
}
#[tauri::command]
async fn mail(app: AppHandle, before: Option<i64>) -> Result<Mail> {
    let a = app.state::<App>();
    let _guard = a.account.lock().await;
    if !a.core().store.settings().cloud {
        return Ok(Mail::default());
    }
    a.cloud.mail(before).await
}
#[tauri::command]
async fn account_mode(app: AppHandle, passcode: Option<String>) -> Result<()> {
    let a = app.state::<App>();
    if !cfg!(feature = "cloud-sync") {
        return Err("这个绿色版使用本机存档".into());
    }
    let _guard = a.account.lock().await;
    let online = passcode.is_some();
    #[cfg(feature = "cloud-sync")]
    let previous = platform::credentials::read()?;
    if let Some(pass) = passcode {
        a.cloud.login(&pass).await?;
    }
    {
        let mut c = a.core();
        let open = !c.locked;
        c.store
            .clock(platform::awake_seconds(), store::now(), open)?;
        c.store.configure(|s| s.cloud = online)?;
        c.cloud_placed.clear();
        c.cloud_name = store::default_name();
        c.cloud_atmosphere = default_atmosphere();
    }
    #[cfg(feature = "cloud-sync")]
    if !online {
        platform::credentials::clear()?;
    }
    sync(&app, true);
    sync_name(&app, &a);
    #[cfg(feature = "cloud-sync")]
    if let Some(token) = previous {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            handle.state::<App>().cloud.revoke(&token).await;
        });
    }
    if online {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let a = handle.state::<App>();
            let _guard = a.account.lock().await;
            let connected = a.core().store.settings().cloud;
            if connected && a.cloud.simple("visit").await.is_ok() {
                let _ = refresh_cloud_home(&handle, &a).await;
            }
        });
    }
    Ok(())
}
fn setup(app: &mut tauri::App) -> std::result::Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    let handle = app.handle().clone();
    let (tx, rx) = mpsc::channel();
    let native = Native::install(tx.clone())?;
    let display = native.display(0);
    let mut save_root = app.path().app_local_data_dir()?;
    if std::env::args().any(|a| a == "--verify-profile") {
        save_root.push("acceptance");
    }
    updater::init(&save_root)?;
    let mut store = Store::open(&save_root, platform::awake_seconds())?;
    let album = LocalAlbum::open(store.root())?;
    if !cfg!(feature = "cloud-sync") && store.settings().cloud {
        store.configure(|s| s.cloud = false)?;
    }
    app.manage(App {
        native,
        shortcut_tx: tx,
        core: Mutex::new(Runtime {
            store,
            album,
            display,
            stage_ready: false,
            on_desktop: false,
            visible: false,
            selecting: false,
            camera: false,
            desktop_camera: false,
            play_mode: false,
            locked: false,
            wall_active: false,
            at_furniture: false,
            card: false,
            card_seq: 0,
            card_open: CardOpen::default(),
            cloud_placed: vec![],
            cloud_name: store::default_name(),
            cloud_atmosphere: default_atmosphere(),
            revision: 0,
        }),
        cloud: Cloud::new()?,
        account: Default::default(),
        root: scenes::roots(&save_root)?,
    });
    let furniture = build_window(&handle, "furnishings", "furnishings.html")?;
    furniture.set_ignore_cursor_events(true)?;
    let wallpaper = build_window(&handle, "wallpaper", "wallpaper.html")?;
    wallpaper.set_ignore_cursor_events(true)?;
    let stage = build_window(&handle, "stage", "index.html")?;
    #[cfg(windows)]
    stage.set_position(PhysicalPosition::new(display.screen.x, display.screen.y))?;
    let keys = app.state::<App>().native.shortcuts();
    let toggle = format!("切换小兔状态    {}", keys[0].as_deref().unwrap_or(""));
    let switch = format!("开关场景壁纸    {}", keys[1].as_deref().unwrap_or(""));
    let menu = Menu::new(app)?;
    for (id, label) in [
        ("toggle", toggle.as_str()),
        ("switch", switch.as_str()),
        ("desktop", "仅在桌面"),
        ("overlay", "悬浮置顶"),
        ("play", "开关点地移动"),
        ("camera", "打开拍立得相机"),
        ("card", "翻开手账"),
        ("fence", "划定活动区"),
        ("quit", "退出 FUTARI"),
    ] {
        let i = MenuItem::with_id(app, id, label, true, None::<&str>)?;
        menu.append(&i)?;
    }
    TrayIconBuilder::with_id("nest")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip(format!("FUTARI · {}", app.state::<App>().core().name()))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "toggle" => event(app, NativeEvent::Toggle),
            "switch" => event(app, NativeEvent::Switch),
            "desktop" => {
                let _ = change_mode(app, Mode::Desktop);
            }
            "overlay" => {
                let _ = change_mode(app, Mode::Overlay);
            }
            "play" => {
                let next = !app.state::<App>().core().play_mode;
                let _ = set_option(app.clone(), Setting::PlayMode(next));
            }
            "camera" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = open_camera_mode(&handle, None).await;
                });
            }
            "card" => {
                let _ = show_card(app, None, CardOpen::default());
            }
            "fence" => {
                let _ = set_option(app.clone(), Setting::SelectFence);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    std::thread::spawn(move || {
        while let Ok(e) = rx.recv() {
            let h = handle.clone();
            if handle.run_on_main_thread(move || event(&h, e)).is_err() {
                break;
            }
        }
    });
    let updater_handle=app.handle().clone();
    tauri::async_runtime::spawn(async move { tokio::time::sleep(std::time::Duration::from_secs(5)).await;let _=check_update(updater_handle).await; });
    sync(app.handle(), true);
    if app.state::<App>().core().store.settings().cloud {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            let a = handle.state::<App>();
            let _guard = a.account.lock().await;
            if a.core().store.settings().cloud {
                let _ = refresh_cloud_home(&handle, &a).await;
            }
        });
    }
    Ok(())
}
fn main() {
    let app = tauri::Builder::default()
        .register_uri_scheme_protocol("futari-ui", |_, req| {
            if req.method() != tauri::http::Method::GET {
                return tauri::http::Response::builder().status(405).body(Vec::new()).unwrap();
            }
            updater::serve(req.uri().path())
        })
        .setup(setup)
        .invoke_handler(tauri::generate_handler![
            updater::ui_bundle_info,updater::ui_bundle_rollback,updater::apply_ui_update,updater::check_update,updater::update_status,
            desktop_view,
            focused_shortcut,
            capture_desktop,
            update_hit,
            furniture_contact,
            close_notebook,
            report_scene,
            scene_list,
            scene_layer,
            set_option,
            finish_fence,
            tend,
            stage_act,
            exit_stage_mode,
            open_card,
            food_drag,
            set_atmosphere,
            start_camera,
            album_list,
            album_image,
            album_upload,
            album_title,
            album_delete,
            save_print,
            home,
            rename,
            mail,
            account_mode
        ])
        .build(tauri::generate_context!());
    match app {
        Ok(a) => a.run(|h, e| {
            if matches!(e, tauri::RunEvent::Exit) {
                if let Some(a) = h.try_state::<App>() {
                    let mut c = a.core();
                    let open = !c.locked;
                    let _ = c.store.clock(platform::awake_seconds(), store::now(), open);
                }
            }
        }),
        Err(e) => platform::startup_error(&e.to_string()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn layer_cycle_and_snow_shortcut() {
        assert_eq!(toggle_step(Mode::Hidden), Mode::Desktop);
        assert_eq!(toggle_step(Mode::Desktop), Mode::Overlay);
        assert_eq!(toggle_step(Mode::Overlay), Mode::Hidden);
        for mode in [Mode::Overlay, Mode::Hidden, Mode::Desktop] {
            let mut cfg = Settings { mode, ..Settings::default() };
            set_wallpaper(&mut cfg, true);
            assert_eq!(cfg.mode, mode);
            assert_eq!(cfg.scene, "snow-forest");
            assert!(!cfg.wallpaper_above_icons);
            cfg.wallpaper_above_icons = true;
            set_wallpaper(&mut cfg, false);
            assert_eq!(cfg.mode, mode);
            assert!(cfg.wallpaper_above_icons);
        }
    }
}
