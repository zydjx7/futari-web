# FUTARI Desktop

Windows x64 免安装桌宠。解压 `dist/FUTARI-Desktop-Windows-x64.zip`，双击 `FUTARI Desktop.exe`。整份目录可以放在 F 盘。程序使用系统 WebView2，启动后从任务栏右侧的兔子图标操作。

## 使用

- 初次启动时，焦糖兔在任务栏上方的透明窄条里活动。轻点摸头，按住拖动，右键或双击翻开手账。手账右上角的 × 和 Esc 都能合上卡片；从托盘选「退出 FUTARI」结束进程。
- Windows 按 Alt+Q 循环切换「隐身 → 仅在桌面 → 悬浮置顶」。仅在桌面的小兔会在应用窗口后面活动，最小化窗口即可看到。关闭壁纸时只留下系统桌面与小兔，兔子大小与全屏漫步一致。悬浮置顶的小兔也会出现在网页上。
- Alt+W 单独开关场景壁纸，默认铺在桌面图标下方。手账设置里的「壁纸在图标上方」与「点地移动」相邻。切换兔子显示层级保留壁纸选择。开启点地移动后可直接单击桌面空地，在手账设置或托盘里可以关闭。
- macOS 全局使用 ⌥J 和 ⌥K。若组合键注册失败，可从菜单栏兔子图标切换。风景册可选择雪松林、棉纸和自定义场景。
- 手账的「设置」可选任务栏、角落、全屏或拖框；屏幕顶部有取消按钮。进入隐身或锁屏时舞台停止逐帧绘制。
- 「小铺子」可购买物品，「小篮子」可以喂食。首次本机兔窝有 6 颗小橡果、2 份提摩西草和 1 份胡萝卜。登录 Windows 且程序运行时，每满 5 分钟积 1 颗，每天最多 12 颗。每天第一次摸头额外加 1 颗。单独的本机文件 `%LOCALAPPDATA%\app.futari.desktop\nest.json` 原子保存，重新打开可续养。退出期间不计时。

## 自制场景

点「风景册 → 打开场景文件夹」。在 EXE 旁的 `scenes/` 新建小写英文、数字与连字符目录，如 `window-seat/`，放入清晰的背景 `bg.webp`、全幅透明前景 `fg.webp` 与以下 `scene.json`。点击「刷新场景」即可选用。普通自制包的前后景按相同画幅铺满显示器，建议采用同尺寸的横版图片。

```json
{"version":1,"title":"午后的窗边","horizon":0.52,"foregroundDepth":0.85,"weather":"clear"}
```

`horizon` 指可活动雪坡的远端，`foregroundDepth` 决定前景遮挡深度。坐标均从屏幕顶部起算，取 0 到 1 的比例；`horizon` 可取 0.15 至 0.84。`weather` 可用 `clear` 或 `snow`。内置 `snow-forest` 使用已验收的专有前景部件布局。图片每张最多 8 MiB、最长边 4096、总像素最多 1000 万。只读取固定名称的 JSON 和静态 WebP。

## 从源码构建

在项目根目录的普通 PowerShell 运行。开发电脑需要 Node、Rust stable x86_64-pc-windows-msvc、MSVC x64 Build Tools、Windows SDK 和系统 WebView2。构建产物及 Cargo 目标目录都在 `desktop/` 下。

```powershell
Set-Location 'F:\FUTARI'
.\desktop\scripts\build.ps1
& '.\desktop\dist\FUTARI Desktop\FUTARI Desktop.exe'
```

`scripts/prepare.mjs` 从网站模块复制已验收的图集、骨骼动画、手账绘制和道具目录，再由 Tauri 编入 EXE。`ui/` 是本地舞台与手账，`src-tauri/src/platform/` 隔离 Win32 窗口、屏幕、热键、鼠标命中与系统凭据。macOS 使用同一套前端，由 `platform/macos.rs` 经 AppKit、CoreGraphics 和 Carbon 接入菜单栏、窗口、指针与快捷键。macOS 的令牌存入系统钥匙串。构建方法见[项目说明](../README.md#macos-桌宠出包)，使用方法见[macOS 使用说明](使用说明-macOS.txt)。

## 安全与存档

- 有效的 WebView 入口限定为内置的舞台与手账地址。CSP 约束外部脚本、子页面和网络连接。自定义协议的 `ipc.localhost` 由系统 WebView 内部处理，程序没有本地监听服务。
- Rust 为舞台和手账分别授权命令。透明舞台的输入通过原生窗口的 GDI 区域传递，区域由兔子画面实际的 alpha 生成。独立手账按需创建，透明工作区保持鼠标穿透。系统文件夹操作仅可打开 EXE 同目录下固定的 scenes；场景校验会拒绝路径跳转和重解析点。
- 绿色包启用 Cargo 的 `cloud-sync`。首次使用本机兔窝。正式站上线桌面服务后，在手账「设置 → 连接云端兔窝」输入她的暗号。Rust 客户端内置专用 HTTPS 地址，凭据存入 Windows 凭据管理器。云端共用网页版的余额、库存、摆件和火漆信。断网会提示并重试，设置中可以切回本机存档。
- 附件 ZIP 仅收录程序、说明和内置雪景。存档、凭据及后加入的私有场景不会被打包。

## 复验

```powershell
npm test
node --test desktop/tests/*.test.mjs
node desktop/scripts/prepare.mjs
$env:CARGO_TARGET_DIR = 'F:\FUTARI\desktop\build\cargo'
cargo test --locked --release --features cloud-sync --manifest-path desktop/src-tauri/Cargo.toml
```

GUI 验收可用 `--verify-profile` 启动解压版，在应用自己的 `acceptance/` 中单独存档。先退出另一份实例，便于验证同一组全局热键。检查任务栏位置、穿透到记事本的点击、合上手账、开关热键、前台遮挡与重启续养。申请云端服务或生成安装器都独立于本机验收。
