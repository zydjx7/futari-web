use super::*;
use std::{
    cell::Cell,
    ffi::OsString,
    fs::File,
    mem::{size_of, zeroed},
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        io::AsRawHandle,
    },
    path::PathBuf,
    ptr::{null, null_mut},
    sync::OnceLock,
};
use windows_sys::Win32::{
    Foundation::*,
    Graphics::Gdi::*,
    Storage::FileSystem::GetFinalPathNameByHandleW,
    System::{
        LibraryLoader::GetModuleHandleW, RemoteDesktop::*,
        WindowsProgramming::QueryUnbiasedInterruptTime,
    },
    UI::{
        Accessibility::*, HiDpi::GetDpiForWindow, Input::KeyboardAndMouse::*, Shell::ShellExecuteW,
        WindowsAndMessaging::*,
    },
};
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain([0]).collect()
}
fn cname(w: HWND) -> String {
    let mut buf = [0u16; 128];
    unsafe {
        let n = GetClassNameW(w, buf.as_mut_ptr(), 128);
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }
}
static EVENTS: OnceLock<Sender<NativeEvent>> = OnceLock::new();
fn send(e: NativeEvent) {
    if let Some(s) = EVENTS.get() {
        let _ = s.send(e);
    }
}
thread_local! {static DOWN:Cell<Option<(i32,i32,bool)>>=const{Cell::new(None)};}
fn cursor() -> POINT {
    unsafe {
        let mut p = POINT::default();
        GetCursorPos(&mut p);
        p
    }
}
unsafe extern "system" fn foreground(
    _: HWINEVENTHOOK,
    _: u32,
    _: HWND,
    _: i32,
    _: i32,
    _: u32,
    _: u32,
) {
    send(NativeEvent::Foreground)
}
unsafe extern "system" fn proc(w: HWND, m: u32, a: WPARAM, b: LPARAM) -> LRESULT {
    match m {
        WM_MOUSEACTIVATE => return MA_NOACTIVATE as isize,
        WM_DISPLAYCHANGE | WM_SETTINGCHANGE => send(NativeEvent::Display),
        WM_WTSSESSION_CHANGE => {
            if a == WTS_SESSION_LOCK as usize || a == WTS_SESSION_UNLOCK as usize {
                send(NativeEvent::Lock(a == WTS_SESSION_LOCK as usize))
            }
        }
        WM_TIMER => send(NativeEvent::Tick),
        WM_RBUTTONDOWN => {
            SetCapture(w);
        }
        WM_LBUTTONDOWN => {
            let p = cursor();
            SetCapture(w);
            DOWN.set(Some((p.x, p.y, false)));
        }
        WM_LBUTTONDBLCLK | WM_RBUTTONUP => {
            DOWN.set(None);
            if GetCapture() == w {
                ReleaseCapture();
            }
            let p = cursor();
            send(NativeEvent::Card(p.x, p.y));
        }
        WM_MOUSEMOVE => {
            let p = cursor();
            if let Some((x, y, drag)) = DOWN.get() {
                if drag || (p.x - x).abs() + (p.y - y).abs() > 5 {
                    DOWN.set(Some((x, y, true)));
                    if !drag {
                        send(NativeEvent::DragStart(x, y));
                    }
                    send(NativeEvent::Drag(p.x, p.y));
                }
            } else {
                use std::sync::atomic::AtomicU64;
                static LAST_HOVER: AtomicU64 = AtomicU64::new(0);
                let mut now = 0u64;
                QueryUnbiasedInterruptTime(&mut now);
                let prev = LAST_HOVER.load(Ordering::Relaxed);
                if now.saturating_sub(prev) >= 250_000 {
                    LAST_HOVER.store(now, Ordering::Relaxed);
                    send(NativeEvent::Hover(p.x, p.y));
                }
            }
        }
        WM_LBUTTONUP => {
            let was = DOWN.take();
            ReleaseCapture();
            if let Some((_, _, drag)) = was {
                let p = cursor();
                send(if drag {
                    NativeEvent::Drop
                } else {
                    NativeEvent::Click(p.x, p.y)
                });
            }
        }
        WM_CAPTURECHANGED => {
            if DOWN.take().is_some_and(|v| v.2) {
                send(NativeEvent::Drop)
            }
        }
        _ => return DefWindowProcW(w, m, a, b),
    }
    0
}
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
static WALK: AtomicBool = AtomicBool::new(false);
static PLAY_CAPTURE: AtomicBool = AtomicBool::new(false);
static ALT_HOOK_MASK: AtomicU8 = AtomicU8::new(0);
// The stage stays click-through. Only ask Explorer about completed clicks on its desktop.
const WM_GROUND_MODE: u32 = WM_APP + 42;
static GROUND_POINTS: OnceLock<std::sync::mpsc::SyncSender<(i32, i32)>> = OnceLock::new();
thread_local! { static GROUND_DOWN: Cell<Option<(i32, i32)>> = const { Cell::new(None) }; }

unsafe fn desktop_at(p: POINT) -> bool {
    let hit = WindowFromPoint(p);
    let root = GetAncestor(hit, GA_ROOT);
    if !matches!(cname(root).as_str(), "Progman" | "WorkerW") { return false; }
    let mut pid = 0;
    let mut shell = 0;
    GetWindowThreadProcessId(root, &mut pid);
    GetWindowThreadProcessId(GetShellWindow(), &mut shell);
    pid != 0 && pid == shell && matches!(cname(hit).as_str(),
        "SysListView32" | "SHELLDLL_DefView" | "WorkerW" | "Progman")
}

unsafe extern "system" fn ground_hook(code: i32, msg: WPARAM, data: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 && PLAY_CAPTURE.load(Ordering::Relaxed) && data != 0 {
        let p = (*(data as *const MSLLHOOKSTRUCT)).pt;
        match msg as u32 {
            WM_LBUTTONDOWN => {
                let plain = [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN].iter()
                    .all(|k| GetAsyncKeyState(i32::from(*k)) >= 0);
                GROUND_DOWN.set((plain && desktop_at(p)).then_some((p.x,p.y)));
            }
            WM_MOUSEMOVE => {
                if GROUND_DOWN.get().is_some_and(|(x,y)| (x-p.x).abs().max((y-p.y).abs()) > 4) {
                    GROUND_DOWN.set(None);
                }
            }
            WM_LBUTTONUP => {
                if GROUND_DOWN.take().is_some() && desktop_at(p) {
                    if let Some(tx) = GROUND_POINTS.get() { let _ = tx.try_send((p.x,p.y)); }
                }
            }
            _ => (),
        }
    }
    CallNextHookEx(null_mut(), code, msg, data)
}
fn ground_listener() -> Result<()> {
    use ::windows::Win32::{Foundation::POINT as ScreenPoint,
        System::{Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED}, Variant::VARIANT},
        UI::Accessibility::{AccessibleObjectFromPoint, ROLE_SYSTEM_LIST, ROLE_SYSTEM_PANE, ROLE_SYSTEM_CLIENT}};
    let (tx, rx) = std::sync::mpsc::sync_channel(8);
    std::thread::Builder::new().name("desktop-ground".into()).spawn(move || unsafe {
        if CoInitializeEx(None, COINIT_MULTITHREADED).is_err() { return; }
        for (x,y) in rx {
            if !PLAY_CAPTURE.load(Ordering::Relaxed) || !desktop_at(POINT {x,y}) { continue; }
            let mut object = None;
            let mut child = VARIANT::default();
            if AccessibleObjectFromPoint(ScreenPoint {x,y}, &mut object, &mut child).is_err() { continue; }
            let role = object.and_then(|o| o.get_accRole(&child).ok())
                .and_then(|v| i32::try_from(&v).ok()).map(|v| v as u32);
            if matches!(role, Some(ROLE_SYSTEM_LIST | ROLE_SYSTEM_PANE | ROLE_SYSTEM_CLIENT)) {
                send(NativeEvent::Ground(x,y));
            }
        }
        CoUninitialize();
    }).map_err(|e| e.to_string())?;
    GROUND_POINTS.set(tx).map_err(|_| "重复安装桌面点击监听".to_string())
}
// A normal release or a fresh Alt chord clears typematic suppression immediately.
// The deadline also recovers if the hook misses both releases during a focus change.
thread_local! { static REPEAT_UNTIL: Cell<[Option<Instant>; 2]> = const { Cell::new([None; 2]) }; }
unsafe extern "system" fn key_hook(code: i32, a: WPARAM, b: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 && b != 0 {
        let kb = &*(b as *const KBDLLHOOKSTRUCT);
        let msg = a as u32;
        if kb.vkCode == u32::from(VK_ESCAPE) && matches!(msg, WM_KEYDOWN | WM_SYSKEYDOWN)
            && WALK.load(Ordering::Relaxed)
            && matches!(cname(GetForegroundWindow()).as_str(), "Progman" | "WorkerW")
            && PLAY_CAPTURE.load(Ordering::Relaxed)
        {
            send(NativeEvent::ExitPlay);
            return 1;
        }
        if matches!(kb.vkCode as u16, VK_MENU | VK_LMENU | VK_RMENU) {
            REPEAT_UNTIL.set([None; 2]);
        } else if let Some(key) = match kb.vkCode {
            v if v == u32::from(b'Q') => Some(Shortcut::Toggle),
            v if v == u32::from(b'W') => Some(Shortcut::Switch),
            _ => None,
        } {
            let index = key as usize;
            let mut repeat = REPEAT_UNTIL.get();
            if msg == WM_KEYUP || msg == WM_SYSKEYUP {
                repeat[index] = None;
                REPEAT_UNTIL.set(repeat);
            } else if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN)
                && (ALT_HOOK_MASK.load(Ordering::Relaxed) & (1 << index)) != 0
                && (kb.flags & LLKHF_ALTDOWN) != 0
                && GetAsyncKeyState(i32::from(VK_CONTROL)) >= 0
                && GetAsyncKeyState(i32::from(VK_SHIFT)) >= 0
                && GetAsyncKeyState(i32::from(VK_LWIN)) >= 0
                && GetAsyncKeyState(i32::from(VK_RWIN)) >= 0
            {
                let now = Instant::now();
                if repeat[index].is_none_or(|until| now >= until) {
                    if let Some(tx) = EVENTS.get() {
                        key.dispatch(tx);
                    }
                }
                repeat[index] = Some(now + Duration::from_millis(1200));
                REPEAT_UNTIL.set(repeat);
                return 1;
            }
        }
    }
    CallNextHookEx(null_mut(), code, a, b)
}
// Keep the shortcut message pump independent from WebView focus changes and menus.
fn keyboard_listener() -> Result<(u32, [Option<String>; 2])> {
    ground_listener()?;
    let (ready, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::Builder::new().name("futari-shortcuts".into()).spawn(move || unsafe {
        let mut msg = MSG::default();
        PeekMessageW(&mut msg, null_mut(), 0, 0, PM_NOREMOVE);
        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(key_hook), null_mut(), 0);
        let mut mouse: HHOOK = null_mut();
        let register = |id, key: u8, bit| {
            let registered = RegisterHotKey(null_mut(), id, MOD_ALT | MOD_NOREPEAT, u32::from(key)) != 0;
            if !hook.is_null() {
                ALT_HOOK_MASK.fetch_or(bit, Ordering::Relaxed);
            }
            if registered || !hook.is_null() {
                return Some(format!("Alt+{}", char::from(key)));
            }
            (RegisterHotKey(null_mut(), id, MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT,
                            u32::from(key)) != 0).then(|| format!("Ctrl+Alt+Shift+{}", char::from(key)))
        };
        let keys = [register(1, b'Q', 1), register(2, b'W', 2)];
        let id = windows_sys::Win32::System::Threading::GetCurrentThreadId();
        if ready.send((id, keys)).is_ok() {
            while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
                if msg.message == WM_GROUND_MODE {
                    GROUND_DOWN.set(None);
                    if PLAY_CAPTURE.load(Ordering::Relaxed) && mouse.is_null() {
                        mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(ground_hook), null_mut(), 0);
                        if mouse.is_null() { send(NativeEvent::ExitPlay); }
                    } else if !PLAY_CAPTURE.load(Ordering::Relaxed) && !mouse.is_null() {
                        UnhookWindowsHookEx(mouse);
                        mouse = null_mut();
                    }
                } else if msg.message == WM_HOTKEY {
                    if let Some(tx) = EVENTS.get() {
                        match msg.wParam {
                            1 => Shortcut::Toggle.dispatch(tx),
                            2 => Shortcut::Switch.dispatch(tx),
                            _ => (),
                        }
                    }
                }
            }
        }
        if !mouse.is_null() { UnhookWindowsHookEx(mouse); }
        UnregisterHotKey(null_mut(), 1);
        UnregisterHotKey(null_mut(), 2);
        if !hook.is_null() { UnhookWindowsHookEx(hook); }
        ALT_HOOK_MASK.store(0, Ordering::Relaxed);
    }).map_err(|e| e.to_string())?;
    receiver.recv().map_err(|e| e.to_string())
}
pub struct Native {
    #[allow(dead_code)]
    desktop_foreground: AtomicBool,
    hit: isize,
    hook: isize,
    key_thread: u32,
    keys: [Option<String>; 2],
}
fn rect(r: RECT) -> Rect {
    Rect {
        x: r.left,
        y: r.top,
        w: r.right - r.left,
        h: r.bottom - r.top,
    }
}
unsafe fn find_child(parent: HWND, class: &str) -> HWND {
    FindWindowExW(parent, null_mut(), wide(class).as_ptr(), null())
}
// Place our surface immediately above Explorer's icon host, below ordinary windows.
unsafe fn icon_host() -> HWND {
    let shell = GetShellWindow();
    if !shell.is_null() && !find_child(shell, "SHELLDLL_DefView").is_null() {
        return shell;
    }
    unsafe extern "system" fn visit(w: HWND, arg: LPARAM) -> i32 {
        let mut shell = 0;
        let mut owner = 0;
        GetWindowThreadProcessId(GetShellWindow(), &mut shell);
        GetWindowThreadProcessId(w, &mut owner);
        if shell != 0 && owner == shell && !find_child(w, "SHELLDLL_DefView").is_null() {
            *(arg as *mut HWND) = w;
            0
        } else {
            1
        }
    }
    let mut host: HWND = null_mut();
    EnumWindows(Some(visit), &mut host as *mut _ as isize);
    if host.is_null() {
        shell
    } else {
        host
    }
}
unsafe fn above(w: HWND, anchor: HWND) -> (HWND, u32) {
    if GetWindowLongPtrW(w, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST != 0 {
        SetWindowPos(
            w,
            HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
    if anchor.is_null() {
        return (HWND_BOTTOM, 0);
    }
    let prev = GetWindow(anchor, GW_HWNDPREV);
    if prev == w {
        (HWND_TOP, SWP_NOZORDER)
    } else if prev.is_null() || GetWindowLongPtrW(prev, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST != 0 {
        (HWND_TOP, 0)
    } else {
        (prev, 0)
    }
}
// A non-activating overlay can still own the foreground after play or camera mode.
unsafe fn release_stage_focus(stage: HWND) {
    if GetForegroundWindow() != stage {
        return;
    }
    let mut next = GetTopWindow(null_mut());
    while !next.is_null() {
        let mut owner = 0;
        GetWindowThreadProcessId(next, &mut owner);
        let ex = GetWindowLongPtrW(next, GWL_EXSTYLE) as u32;
        if owner != std::process::id()
            && IsWindowVisible(next) != 0
            && IsIconic(next) == 0
            && ex & (WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) == 0
            && SetForegroundWindow(next) != 0
        {
            return;
        }
        next = GetWindow(next, GW_HWNDNEXT);
    }
    SetForegroundWindow(GetShellWindow());
}
unsafe fn valid_worker(w: HWND) -> HWND {
    if w.is_null() {
        return null_mut();
    }
    if IsWindowVisible(w) == 0 {
        ShowWindow(w, SW_SHOWNA);
    }
    let mut r = RECT::default();
    if GetWindowRect(w, &mut r) == 0 || r.right <= r.left || r.bottom <= r.top || IsWindowVisible(w) == 0
    {
        return null_mut();
    }
    w
}
unsafe fn wallpaper_host() -> HWND {
    let prog = FindWindowW(wide("Progman").as_ptr(), null());
    if prog.is_null() {
        return null_mut();
    }
    let existing = existing_wallpaper_host(prog);
    if !existing.is_null() { return existing; }
    let mut result = 0;
    SendMessageTimeoutW(prog, 0x052c, 0xd, 1, SMTO_ABORTIFHUNG, 250, &mut result);
    existing_wallpaper_host(prog)
}
unsafe fn existing_wallpaper_host(prog: HWND) -> HWND {
    let def_view = find_child(prog, "SHELLDLL_DefView");
    if !def_view.is_null() {
        let child = valid_worker(find_child(prog, "WorkerW"));
        if !child.is_null() {
            SetWindowPos(
                child,
                def_view,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
            return child;
        }
    }
    unsafe extern "system" fn visit(w: HWND, arg: LPARAM) -> i32 {
        if !find_child(w, "SHELLDLL_DefView").is_null() {
            let candidate = FindWindowExW(null_mut(), w, wide("WorkerW").as_ptr(), null());
            if !candidate.is_null() {
                *(arg as *mut HWND) = candidate;
                return 0;
            }
        }
        1
    }
    let mut out: HWND = null_mut();
    EnumWindows(Some(visit), &mut out as *mut _ as isize);
    if !out.is_null() {
        let mut shell = 0;
        let mut owner = 0;
        GetWindowThreadProcessId(prog, &mut shell);
        GetWindowThreadProcessId(out, &mut owner);
        if owner != shell {
            return null_mut();
        }
    }
    valid_worker(out)
}
impl PlatformController for Native {
    fn furnishings(&self, window: isize, d: Display, visible: bool, anchor: isize) {
        if visible {
            self.present(window, d, Mode::Desktop, anchor, true, false, false);
        } else {
            unsafe { ShowWindow(window as HWND, SW_HIDE); }
        }
    }
    fn set_ground_input(&self, enabled: bool, walk: bool) {
        WALK.store(walk, Ordering::Relaxed);
        if PLAY_CAPTURE.swap(enabled, Ordering::Relaxed) != enabled {
            unsafe { PostThreadMessageW(self.key_thread, WM_GROUND_MODE, 0, 0); }
        }
    }
    fn install(events: Sender<NativeEvent>) -> Result<Self> {
        unsafe {
            EVENTS.set(events).map_err(|_| "桌面控制器重复初始化")?;
            let class = wide("FutariPetInput");
            let inst = GetModuleHandleW(null());
            let wc = WNDCLASSW {
                style: CS_DBLCLKS,
                lpfnWndProc: Some(proc),
                hInstance: inst,
                lpszClassName: class.as_ptr(),
                hCursor: LoadCursorW(null_mut(), IDC_HAND),
                hbrBackground: GetStockObject(BLACK_BRUSH) as _,
                ..zeroed()
            };
            if RegisterClassW(&wc) == 0 {
                return Err("无法注册桌宠交互窗口".into());
            }
            let w = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                class.as_ptr(),
                wide("FUTARI touch").as_ptr(),
                WS_POPUP,
                0,
                0,
                1,
                1,
                null_mut(),
                null_mut(),
                inst,
                null(),
            );
            if w.is_null() {
                return Err("无法建立桌宠交互窗口".into());
            }
            SetLayeredWindowAttributes(w, 0, 1, LWA_ALPHA);
            let hook = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                null_mut(),
                Some(foreground),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            );
            if hook.is_null() {
                return Err("无法订阅桌面切换".into());
            }
            WTSRegisterSessionNotification(w, NOTIFY_FOR_THIS_SESSION);
            SetTimer(w, 1, 60000, None);
            let (key_thread, keys) = keyboard_listener()?;
            Ok(Self {
                desktop_foreground: AtomicBool::new(false),
                hit: w as isize,
                hook: hook as isize,
                key_thread,
                keys,
            })
        }
    }
    fn shortcuts(&self) -> [Option<String>; 2] {
        self.keys.clone()
    }
    fn hide_card(&self, window: isize) {
        unsafe {
            ShowWindow(window as HWND, SW_HIDE);
        }
    }
    fn display(&self, stage: isize) -> Display {
        unsafe {
            let mon = if stage == 0 {
                MonitorFromPoint(cursor(), MONITOR_DEFAULTTOPRIMARY)
            } else {
                MonitorFromWindow(stage as _, MONITOR_DEFAULTTONEAREST)
            };
            let mut m: MONITORINFO = zeroed();
            m.cbSize = size_of::<MONITORINFO>() as u32;
            GetMonitorInfoW(mon, &mut m);
            Display {
                screen: rect(m.rcMonitor),
                work: rect(m.rcWork),
            }
        }
    }
    fn is_desktop(&self, stage: isize, card: isize) -> bool {
        unsafe {
            let w = GetForegroundWindow();
            let class = cname(w);
            if w.is_null()
                || w == stage as HWND
                || w == card as HWND
                || w == self.hit as HWND
                || matches!(
                    class.as_str(),
                    "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "NotifyIconOverflowWindow"
                )
            {
                return self.desktop_foreground.load(Ordering::Relaxed);
            }
            let shell = GetShellWindow();
            let mut shell_pid = 0;
            let mut pid = 0;
            GetWindowThreadProcessId(shell, &mut shell_pid);
            GetWindowThreadProcessId(w, &mut pid);
            let is_desktop = w == shell
                || (shell_pid != 0
                    && shell_pid == pid
                    && matches!(class.as_str(), "Progman" | "WorkerW"));
            self.desktop_foreground.store(is_desktop, Ordering::Relaxed);
            is_desktop
        }
    }
    fn foreground_external(&self, stage: isize, card: isize) -> bool {
        unsafe {
            let w = GetForegroundWindow();
            if w.is_null() || w == stage as HWND || w == card as HWND || w == self.hit as HWND {
                return false;
            }
            let class = cname(w);
            !matches!(
                class.as_str(),
                "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "NotifyIconOverflowWindow"
            )
        }
    }
    fn wallpaper(&self, window: isize, d: Display, visible: bool, above_icons: bool) -> bool {
        unsafe {
            let w = window as HWND;
            if !visible { ShowWindow(w, SW_HIDE); return false; }
            let style = GetWindowLongPtrW(w, GWL_STYLE) as u32 & !(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU);
            SetWindowLongPtrW(w, GWL_STYLE, style as isize);
            let requested = !above_icons;
            let mut parent = if style & WS_CHILD != 0 {
                GetParent(w)
            } else {
                null_mut()
            };
            if requested && parent.is_null() {
                if GetWindowLongPtrW(w, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST != 0 {
                    SetWindowPos(
                        w,
                        HWND_NOTOPMOST,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                    );
                }
                let host = wallpaper_host();
                if !host.is_null() {
                    let child_style = (style & !WS_POPUP) | WS_CHILD;
                    SetWindowLongPtrW(w, GWL_STYLE, child_style as isize);
                    SetParent(w, host);
                    if GetParent(w) == host {
                        parent = host;
                    } else {
                        SetWindowLongPtrW(w, GWL_STYLE, style as isize);
                    }
                }
            }
            if !requested && !parent.is_null() {
                ShowWindow(w, SW_HIDE);
                SetParent(w, null_mut());
                SetWindowLongPtrW(w, GWL_STYLE, ((style & !WS_CHILD) | WS_POPUP) as isize);
                parent = null_mut();
            }
            if requested && parent.is_null() {
                ShowWindow(w, SW_HIDE);
                return false;
            }
            let ex = GetWindowLongPtrW(w, GWL_EXSTYLE) as u32;
            SetWindowLongPtrW(w, GWL_EXSTYLE, (ex | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) as isize);
            // A layered scenery HWND needs an explicit opacity after reparenting.
            SetLayeredWindowAttributes(w, 0, 255, LWA_ALPHA);
            let mut pt = POINT { x: d.screen.x, y: d.screen.y };
            let (z, flags) = if parent.is_null() { above(w, icon_host()) } else {
                ScreenToClient(parent, &mut pt);
                (HWND_TOP, 0)
            };
            SetWindowPos(w,z,pt.x,pt.y,d.screen.w,d.screen.h,flags|SWP_SHOWWINDOW|SWP_NOACTIVATE|SWP_FRAMECHANGED);
            true
        }
    }
    fn present(
        &self,
        stage: isize,
        d: Display,
        _mode: Mode,
        desktop_anchor: isize,
        visible: bool,
        interactive: bool,
        topmost: bool,
    ) {
        unsafe {
            let w = stage as HWND;
            let style = GetWindowLongPtrW(w, GWL_STYLE) as u32;
            SetWindowLongPtrW(w, GWL_STYLE, ((style & !(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU)) | WS_POPUP) as isize);
            let mut ex = GetWindowLongPtrW(w, GWL_EXSTYLE) as u32 | WS_EX_TOOLWINDOW;
            if interactive {
                ex &= !(WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE)
            } else {
                ex |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE
            }
            SetWindowLongPtrW(w, GWL_EXSTYLE, ex as isize);
            if !interactive {
                release_stage_focus(w);
            }
            if !visible {
                SetWindowPos(w, HWND_NOTOPMOST, 0, 0, 0, 0,
                    SWP_HIDEWINDOW | SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                self.hide_hit();
                return;
            }
            let origin = POINT {
                x: d.screen.x,
                y: d.screen.y,
            };
            if IsIconic(w) != 0 { ShowWindow(w, SW_SHOWNOACTIVATE); }
            let (z, flags) = if topmost {
                (HWND_TOPMOST, 0)
            } else if desktop_anchor != 0 {
                above(w, desktop_anchor as HWND)
            } else {
                above(w, icon_host())
            };
            SetWindowPos(
                w,
                z,
                origin.x,
                origin.y,
                d.screen.w,
                d.screen.h,
                flags
                    | SWP_FRAMECHANGED
                    | SWP_SHOWWINDOW
                    | if interactive && topmost { 0 } else { SWP_NOACTIVATE },
            );
            if interactive && topmost {
                SetForegroundWindow(w);
            }
        }
    }
    fn hide_hit(&self) {
        unsafe {
            ShowWindow(self.hit as _, SW_HIDE);
        }
    }
    fn shape(&self, stage: isize, hit: &Hit, top: bool) {
        unsafe {
            let w = self.hit as HWND;
            if hit.rows.is_empty() {
                self.hide_hit();
                return;
            }
            let rgn = CreateRectRgn(0, 0, 0, 0);
            let row = CreateRectRgn(0, 0, 0, 0);
            for &[x, y, r, b] in &hit.rows {
                SetRectRgn(row, x, y, r, b);
                CombineRgn(rgn, rgn, row, RGN_OR);
            }
            DeleteObject(row);
            if SetWindowRgn(w, rgn, 0) == 0 {
                DeleteObject(rgn);
                return;
            }
            let mut p = POINT { x: hit.x, y: hit.y };
            ClientToScreen(stage as _, &mut p);
            let fg = GetForegroundWindow();
            let mut owner = 0;
            GetWindowThreadProcessId(fg, &mut owner);
            let (order, flags) = if !top {
                let target = if GetWindowLongPtrW(stage as HWND, GWL_STYLE) as u32 & WS_CHILD != 0 {
                    icon_host()
                } else {
                    stage as HWND
                };
                above(w, target)
            } else if !fg.is_null()
                && owner == std::process::id()
                && fg != stage as HWND
                && fg != w
                && cname(fg) == "Tauri Window"
            {
                (fg, 0)
            } else {
                (HWND_TOPMOST, 0)
            };
            SetWindowPos(
                w,
                order,
                p.x,
                p.y,
                hit.w,
                hit.h,
                flags | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
        }
    }
    fn card_position(&self, w: isize, x: i32, y: i32, d: Display) {
        unsafe {
            let win = w as HWND;
            let dpi = GetDpiForWindow(win).max(96) as f64 / 96.;
            let width = ((420. * dpi) as i32).min(d.work.w);
            let height = ((540. * dpi) as i32).min(d.work.h);
            let px = (if x + width + 22 < d.work.x + d.work.w {
                x + 14
            } else {
                x - width - 14
            })
            .clamp(d.work.x, d.work.x + d.work.w - width);
            let py = (y - height + 30).clamp(d.work.y, d.work.y + d.work.h - height);
            SetWindowPos(win, HWND_TOPMOST, px, py, width, height, SWP_SHOWWINDOW);
            SetForegroundWindow(win);
        }
    }
    fn open_scenes(&self, path: &Path) -> Result<()> {
        let p: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
        unsafe {
            if ShellExecuteW(
                null_mut(),
                wide("open").as_ptr(),
                p.as_ptr(),
                null(),
                null(),
                SW_SHOWNORMAL,
            ) as isize
                <= 32
            {
                Err("无法打开场景目录".into())
            } else {
                Ok(())
            }
        }
    }
}
impl Drop for Native {
    fn drop(&mut self) {
        unsafe {
            let w = self.hit as HWND;
            PostThreadMessageW(self.key_thread, WM_QUIT, 0, 0);
            UnhookWinEvent(self.hook as _);
            KillTimer(w, 1);
            WTSUnRegisterSessionNotification(w);
            DestroyWindow(w);
        }
    }
}
pub fn awake_seconds() -> u64 {
    let mut t = 0;
    unsafe {
        QueryUnbiasedInterruptTime(&mut t);
    }
    t / 10_000_000
}
// Crop coordinates are fractions of the stage client area, independent of WebView zoom and DPI.
pub fn capture_desktop(stage: isize, [x, y, width, height]: [f64; 4]) -> Result<Vec<u8>> {
    if ![x, y, width, height]
        .iter()
        .all(|v| (0.0..=1.0).contains(v))
        || x + width > 1.000001
        || y + height > 1.000001
    {
        return Err("取景范围超出桌面".into());
    }
    const SIDE: i32 = 720;
    unsafe {
        let mut client = RECT::default();
        let mut origin = POINT::default();
        if GetClientRect(stage as HWND, &mut client) == 0
            || ClientToScreen(stage as HWND, &mut origin) == 0
        {
            return Err("无法定位桌面取景框".into());
        }
        let px = |n: f64| (n * f64::from(client.right)).round() as i32;
        let py = |n: f64| (n * f64::from(client.bottom)).round() as i32;
        let mut info = BITMAPINFO::default();
        info.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = SIDE;
        info.bmiHeader.biHeight = -SIDE;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        let mut bits = null_mut();
        let screen = GetDC(null_mut());
        if screen.is_null() {
            return Err("无法读取桌面画面".into());
        }
        let dc = CreateCompatibleDC(screen);
        let bitmap = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
        let mut result = Err("无法拍下桌面画面".into());
        if !dc.is_null() && !bitmap.is_null() && !bits.is_null() {
            let old = SelectObject(dc, bitmap);
            SetStretchBltMode(dc, HALFTONE);
            SetBrushOrgEx(dc, 0, 0, null_mut());
            windows_sys::Win32::Graphics::Dwm::DwmFlush();
            if !old.is_null()
                && StretchBlt(
                    dc,
                    0,
                    0,
                    SIDE,
                    SIDE,
                    screen,
                    origin.x + px(x),
                    origin.y + py(y),
                    px(x + width) - px(x),
                    py(y + height) - py(y),
                    SRCCOPY | CAPTUREBLT,
                ) != 0
            {
                GdiFlush();
                let mut pixels =
                    std::slice::from_raw_parts(bits.cast::<u8>(), (SIDE * SIDE * 4) as usize)
                        .to_vec();
                for pixel in pixels.chunks_exact_mut(4) {
                    pixel.swap(0, 2);
                    pixel[3] = 255;
                }
                result = Ok(pixels);
            }
            SelectObject(dc, old);
        }
        if !bitmap.is_null() {
            DeleteObject(bitmap);
        }
        if !dc.is_null() {
            DeleteDC(dc);
        }
        ReleaseDC(null_mut(), screen);
        result
    }
}
pub fn cursor_pos() -> (i32, i32) {
    let p = cursor();
    (p.x, p.y)
}
pub fn file_path(f: &File) -> Result<PathBuf> {
    let mut b = vec![0u16; 32768];
    let n = unsafe {
        GetFinalPathNameByHandleW(f.as_raw_handle() as _, b.as_mut_ptr(), b.len() as u32, 0)
    } as usize;
    if n == 0 || n >= b.len() {
        return Err("无法验证文件来源".into());
    }
    Ok(OsString::from_wide(&b[..n]).into())
}
#[cfg(feature = "cloud-sync")]
pub mod credentials {
    use super::*;
    use windows_sys::Win32::Security::Credentials::*;
    const TARGET: &str = "FUTARI Desktop / pet session v1";
    pub fn read() -> Result<Option<String>> {
        unsafe {
            let mut p = null_mut();
            if CredReadW(wide(TARGET).as_ptr(), CRED_TYPE_GENERIC, 0, &mut p) == 0 {
                return if GetLastError() == ERROR_NOT_FOUND {
                    Ok(None)
                } else {
                    Err("无法读取 Windows 凭据".into())
                };
            }
            let v = if (*p).CredentialBlobSize > 0 && (*p).CredentialBlobSize <= 512 {
                String::from_utf8(
                    std::slice::from_raw_parts(
                        (*p).CredentialBlob,
                        (*p).CredentialBlobSize as usize,
                    )
                    .to_vec(),
                )
                .ok()
            } else {
                None
            };
            CredFree(p as _);
            Ok(v)
        }
    }
    pub fn write(t: &str) -> Result<()> {
        unsafe {
            let mut k = wide(TARGET);
            let c = CREDENTIALW {
                Type: CRED_TYPE_GENERIC,
                TargetName: k.as_mut_ptr(),
                CredentialBlob: t.as_ptr() as _,
                CredentialBlobSize: t.len() as u32,
                Persist: CRED_PERSIST_LOCAL_MACHINE,
                ..zeroed()
            };
            if CredWriteW(&c, 0) == 0 {
                return Err("无法保存 Windows 凭据".into());
            }
            Ok(())
        }
    }
    pub fn clear() -> Result<()> {
        unsafe {
            if CredDeleteW(wide(TARGET).as_ptr(), CRED_TYPE_GENERIC, 0) == 0
                && GetLastError() != ERROR_NOT_FOUND
            {
                return Err("无法清除 Windows 凭据".into());
            }
        }
        Ok(())
    }
}
pub fn handle(w: &tauri::WebviewWindow) -> isize {
    w.hwnd().map(|h| h.0 as isize).unwrap_or(0)
}
pub fn startup_error(message: &str) {
    unsafe {
        MessageBoxW(
            null_mut(),
            wide(message).as_ptr(),
            wide("FUTARI Desktop").as_ptr(),
            MB_OK | MB_ICONINFORMATION,
        );
    }
}
