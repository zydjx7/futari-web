# FUTARI

双人私密网站。日常有菜单、小说、Puzzle 和新闻。她可以点导航角落的兔耳或按 Alt+B 召唤焦糖兔，你可以在后台录入内容、调账和留言。[整站定稿](./outputs/双人私密网站-V1设计书.md)

## 在本机打开

使用 Node.js 22.12 或更高版本，在项目根目录的 PowerShell 中运行以下命令。第一次安装依赖后，以后只需运行第二行。

```powershell
npm.cmd ci
npm.cmd run dev
```

打开[本地网站](http://127.0.0.1:8787/)。第一次启动会自动应用本地迁移，并在项目根目录生成独立随机的 `.dev.vars`。之后重启会沿用原来的暗号和数据。开发服务仅监听本机回环地址，停止时按 `Ctrl+C`。

| 本地配置项 | 用途 |
| --- | --- |
| `PASSCODE_HER` | 她的暗号，进入日常视图 |
| `PASSCODE_ADMIN` | 你的暗号，个人菜单里另有「管理」 |
| `SESSION_SECRET` | Worker 签名密钥，仅供服务端使用 |

在本机编辑器打开 `.dev.vars`，复制所需暗号等号右侧的值即可。也可以用下面这行 PowerShell 只复制她的暗号。将变量名替换为 `PASSCODE_ADMIN` 就能验收管理员视图。

```powershell
((Select-String -LiteralPath .dev.vars -Pattern '^PASSCODE_HER=').Line -split '=', 2)[1] | Set-Clipboard
```

三个值互相独立，默认各用 32 字节随机数生成。自行指定时，两句暗号各用 8–256 个字符，签名密钥至少 32 个字符。更换暗号会影响今后的登录，更换签名密钥则会让所有设备重新登录。网页与桌宠分别签发仅在各自服务生效的会话。`.dev.vars` 已加入 Git 忽略规则。正式部署时三项通过 Cloudflare Secrets 配置。[Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

## 正式站 · 两人四台设备验收

你们的电脑和手机都用同一个地址打开 [FUTARI 正式站](https://private-notes.paper-notes-c2909a30.workers.dev/)。

在这台 Windows 电脑上打开 PowerShell，从任意目录运行对应的一行。`admin` 复制你的完整暗号，`her` 复制她的。两个暗号和签名密钥由当前 Windows 用户加密保存，签名密钥只用于服务端。可以将各自的暗号存入常用密码管理器，方便在手机上填写。

```powershell
& 'F:\FUTARI\scripts\copy-production-passcode.ps1' admin
& 'F:\FUTARI\scripts\copy-production-passcode.ps1' her
```

你用管理员暗号，她用自己的暗号。请在各自设备的常用浏览器登录，以下验收对应发布绘本兔窝后的版本。

| 设备 | 操作 | 验收结果 |
| --- | --- | --- |
| 你的电脑 | 从「个人 → 管理」给本周今天录入一道菜和配图，导入一本至少两章的 TXT，录入一道 Puzzle 和一条新闻。从钱包管理页给她加 5 枚并留一句话。打开书的第一章。 | 四项内容在日常导航里可读，图片正常显示。你的个人菜单有管理入口。 |
| 她的办公电脑 | 给那道菜点「想吃」。从书架读到第二章一段容易辨认的文字，停留几秒。点导航兔耳召唤，摸一下头、点木隧道，在小信箱拆开留言，按 `Esc`。再去展开 Puzzle 解析并点「做完了」。 | 收起兔子后仍在刚才那一段，再按 `Esc` 仍留在原页。日常视图静音，标签页标题为 `FUTARI`。她直接访问 `/admin` 会得到 `403`。 |
| 她的手机 | 用移动网络打开同一网址，从书架点同一本书。查看那道 Puzzle 和新闻，再召唤兔子，在商店买一份提摩西草，点蓝碗喂食。在小信箱查看小橡果，再收起兔窝。 | 续读到第二章对应段落，题目仍已完成。购买只记一笔，喂食消耗一份。陪伴收益自动入账一次。手机用「收起」返回阅读。 |
| 你的手机 | 打开书架、菜单管理和钱包管理。用普通窗口查看菜单图片，再将该图片的 `/api/files/…` 地址粘贴到全新的无痕窗口。 | 你续读第一章，能看到她标记的「想吃」、自己的留言和她的消费。同一张图片在已登录窗口能看，无痕窗口返回 `401`。 |

最后，各自在常用浏览器关闭页面再打开，核对仍用原身份进入。要验证退出，只在其中一台设备点「退出登录」。该设备下次进入时显示锁屏，另一台设备仍能使用。

### Windows 与 macOS 桌宠

[FUTARI 桌面应用](https://github.com/zydjx7/futari-desktop) 维护两端原生程序。[版本下载](https://github.com/zydjx7/futari-desktop/releases/latest) 提供已构建的平台压缩包。主站负责网页兔窝、云端接口和受权限保护的下载入口。

修改网站无需下载桌面源码。运行桌面接口测试或签发桌宠 UI 更新前，先执行 `git submodule update --init desktop-app`，取得网站关联的桌面版本。独立应用的构建说明在该仓库首页。

### 本地兔窝下载验收

将所需平台的发行 ZIP 放入网站项目的 `desktop/dist/`，再执行 `node scripts/upload-desktop.mjs --local` 和 `npm run dev`。用她的身份打开兔窝 → 风景册，底部显示已经上传的平台包。Windows 上保持本地站运行，另一个终端运行 `node scripts/check-desktop-download.mjs` 可在 Edge 复验授权、ZIP 完整性并生成截图。

### 正式上线命令清单（由站主执行）

在项目根目录的 PowerShell 按下列顺序执行。`Prepare` 只在当前 Windows 用户的加密凭据文件中暂存两句新暗号，沿用现有签名密钥。`Web` 和 `Desktop` 将同一组 Secrets 随各自的新版代码一起生效；主站成功后，上方复制暗号的命令即返回新值。升级前的会话没有签发用途标记，这次上线后网页和桌宠各登录一次，后续每台设备的会话有效期仍是 180 天。[Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

```powershell
Set-Location 'F:\FUTARI'
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --env production --remote
.\scripts\publish-workers.ps1 Prepare
.\scripts\publish-workers.ps1 Web
.\scripts\publish-workers.ps1 Desktop
node scripts/import-epub.mjs 'C:\Users\96116\Downloads\檀香刑 (莫言) (z-library.sk, 1lib.sk, z-lib.sk).epub' --title '檀香刑' --remote
node scripts/import-epub.mjs 'C:\Users\96116\Downloads\蛊真人错别字修改版4.0 (蛊真人（无足鸟改错）) (z-library.sk, 1lib.sk, z-lib.sk).epub' --title '蛊真人' --remote
node scripts/upload-desktop.mjs --remote
```

Wrangler 按生产 D1 迁移记录只应用待办项，包括 `0010_notes_perf_and_calories.sql`、`0011_session_scope.sql`、`0012_rabbit_name.sql` 以及后续 0013、0014。两个 ZIP 都使用私有 R2；以后拿到 macOS ZIP 后，放回 desktop/dist 再执行最后一行。`Web` 部署主站 `private-notes`，`Desktop` 部署 `desktop/cloud` 的 `futari-desktop`。两步均支持附加 `-DryRun` 仅在本机打包。菜单保留原始每百克或每百毫升热量，已选克数按倍率存储；小面点的半个步进精确到 35 克。

### 复核生产配置

在已登录 Cloudflare 的项目 PowerShell 中运行以下只读命令。Secrets 应列出两项暗号和一项签名密钥，D1 应显示零个待应用迁移，R2 应显示开发域名关闭、自定义域名列表为空。

```powershell
npx.cmd wrangler secret list --env production
npx.cmd wrangler d1 migrations list DB --env production --remote
npx.cmd wrangler r2 bucket dev-url get notes-files --env production
npx.cmd wrangler r2 bucket domain list notes-files --env production
```

## 绘本兔窝本地验收

用她的本地暗号打开一篇可以滚动的小说，停在中间一段。点导航栏角落的兔耳，或按 Windows 的 `Alt+B`、macOS 的 `Option+B` 召唤。在任意抽屉按 `Esc`，或点右上角的关闭按钮，可回到原段和焦点。[本地书架](http://127.0.0.1:8787/novels)

| 操作 | 可以看到 |
| --- | --- |
| 点「风景册」，选雪松林，点击远坡，再点近处雪地。切回纯净无场景后重新召唤。 | 兔子小跳转身、近大远小，在松树和雪桩后会被遮住。场景选择随她的账号保存。 |
| 用另一个浏览器窗口以管理员身份调账并留言。她点「小信箱」，拆开火漆信。 | 有新来信的徽章轻亮，拆开的信可以重读。同一封信在另一台设备也会标为已读。管理页可查看全部收支。[她的钱包](http://127.0.0.1:8787/admin/wallet) |
| 在「小铺子」点道具图，选「带回家」。打开「小篮子」，把草的插画拖到嘴边，或在详情卡点「喂给它」。 | 只消耗一份，兔子开始咀嚼。点蓝碗也可喂食。软窝和柳枝球从篮子里点「摆进窝里」，下次召唤仍在。 |
| 平时读书、做题，或者让日常页在线满五分钟。下次打开小铺子或小信箱。 | 已达到条件的收益静默入账。重复心跳、并行开两个标签页、反复召唤都不会多发。 |

中午可打开今日菜单，下午三点有喝水便签，夜间亮小灯。旧版已经摆出的道具继续摆放，早先的管理员留言也会出现在信箱里。[多朝向小样](./outputs/多朝向立体小样/index.html) · [插画提示词](./outputs/绘本兔窝/插画提示词.md)

### 拍立得与双人相册

1. 在她的兔窝点「风景册」选择光影。「跟随时间」使用当前设备的本地时钟，06:00 起为晴日，16:00 起为黄昏，19:00 起点灯。手动选的光影跟随她的账号。
2. 点「相机」或按 `C`。取景框起初跟着兔子，拖动可固定构图，滚轮或「焦距」滑杆可拉近。「对准兔子」恢复跟随。用键盘时，方向键移动取景框，空格拍摄。手机直接拖框、调滑杆、点「快门」。
3. 在显影的相纸上写一句标题。「下载拍立得 PNG」导出带纸边、日期、场景、标题和批注的 800 × 986 图片。「收进相册」保存这张照片，两种操作均可单独使用。
4. 她从兔窝底部的「相册」翻看，你从「个人 → 管理 → 焦糖兔手账相册」进入同一本相册。点照片放大，两人都可以改标题、下载或确认取下。[管理员相册](http://127.0.0.1:8787/admin/album)
5. 「瞬间收集墙」里的「去拍一张」会带她找到相应动作。雪桩与夜灯入口会选好场景和光影。照片收入相册后，可在对应相框看到红章；取下该瞬间最后一张照片后，相框会重新留白。普通风景照也能收藏。

私有 R2 保存 720 × 720 的原片，D1 记下拍摄地的日期、光影、姿态和标题。改标题后可以重新冲印 PNG。同一张相纸重复保存只入册一次，删除时同步移除 R2 原片。[相册迁移](./migrations/0008_rabbit_photos.sql)

## 第 2 步验收

用普通窗口输入你的管理员暗号，打开[管理页](http://127.0.0.1:8787/admin)。另开无痕窗口输入她的暗号，打开[日常页面](http://127.0.0.1:8787/menu)。保存后在另一窗口刷新，即可看到录入的内容。

| 栏目 | 管理员操作 | 在她的窗口验收 |
| --- | --- | --- |
| [每周菜单](http://127.0.0.1:8787/admin/menu) | 添加两道今天的菜，一道填热量，一道留空，可附一张菜单图。点击「保存整周」。 | 首页定位本周今天。点一道菜的「想吃」，回到管理页刷新可见「她想吃」。补全第二道菜的热量后出现当日合计，原标记仍在。再点一次可取消。 |
| [小说](http://127.0.0.1:8787/admin/novels/new) | 选择 TXT 并保存，书名可沿用文件名。打开任一章节修改正文，也可以新增章节。 | 在她的窗口读到第一章中段，再回书架。用管理员读第二章。两人各自从书架重开同一本，应分别回到第一章原段落和第二章。换浏览器用同一身份登录可验证跨端续读。 |
| [Puzzle](http://127.0.0.1:8787/admin/puzzles/new) | 选「数学」，录入题干、公式、配图、答案与解析，例如公式栏填写 `\sqrt{3^2+4^2}`。 | 切换分类，点开题目配图，再展开「查看解析」。只有点「做完了」才记录完成，刷新后仍显示「已完成」。 |
| [新闻](http://127.0.0.1:8787/admin/news/new) | 分别录入今天和昨天的一则新闻，填写标题、摘要，可附正文和原文链接。 | 默认读今天的精选。选昨天并点「查看」，应能读到昨天的摘要。点标题展开正文，点「原文链接」可打开来源。 |

菜单和题目附图支持 PNG、JPEG、WebP、GIF、AVIF，每张最多 8 MB。小说支持 16 MB 以内的 UTF-8、带 BOM 的 UTF-16，以及常见的 GBK / GB18030 TXT。中文章回、序章和英文 Chapter 标题会自动拆章，无标题的文本按正文导入，过长章节会续分。原始 TXT 可在书籍管理页下载。题干和解析支持用 `\(…\)` 排行内公式，独立公式栏直接填写 LaTeX。[KaTeX 输出格式](https://katex.org/docs/options)

如需一本能滚动验收的小书，下列 PowerShell 命令会在系统临时目录生成 TXT，之后可从「添加书籍」选择它。

```powershell
$sampleBook = @('第一章 来信') + (1..48 | ForEach-Object { "第 $_ 段。她把信移到窗边，想看清邮戳上的日期。" }) + @('第二章 邮戳', '落款的时间比寄出晚了一天。')
$samplePath = Join-Path $env:TEMP 'FUTARI-续读验收.txt'
$sampleBook | Set-Content -LiteralPath $samplePath -Encoding utf8
$samplePath
```

## 第 3 步验收

启动命令仍是 `npm.cmd run dev`。如第 2 步的开发服务还在运行，可在另一个 PowerShell 中执行 `npm.cmd run db:local`，把新迁移应用到本地 D1。用普通窗口登录管理员，进入「个人 → 管理 → 她的钱包」。用无痕窗口以她的身份打开日常页。[她的钱包管理页](http://127.0.0.1:8787/admin/wallet) · [日常页面](http://127.0.0.1:8787/menu)

| 动作 | 在管理员窗口刷新后核对 |
| --- | --- |
| 她打开一个还未赚过奖励的章节，让正文在前台显示至少 5 秒，并读到最后一段末尾。刷新或换设备再读一次。 | 余额增加 2 枚。流水里只有一笔「读完章节」，附书名和章名。只打开长章节、停在开头，仅保存阅读进度。 |
| 她打开一道未完成的 Puzzle，先展开解析，再点「做完了」。 | 展开解析时余额不变。完成后增加 3 枚，同一道题只有一笔流水。升级前已完成的题目保留原记录，奖励从本次升级后的新完成开始计算。 |
| 她打开两个日常标签页，同时在线满 5 分钟，再等一次页面心跳（一般在 30 秒内）。 | 两页重叠时段只算一份，最初 5 分钟自动入账 1 颗小橡果。按东京时间换日，每天最多 12 颗。 |
| 你在后台选择「增加」，填 10 和一句留言，提交后再选择「扣减」，填 3。最后尝试扣减超过余额的数额。 | 两笔流水分别显示 `+10` 和 `−3`，她的余额净增 7。超额扣减显示「余额不足」，余额与流水均保持原值。 |

服务端按心跳之间的实际经过时间累计陪伴，同一时段跨标签、跨设备均只算一次。睡眠或浏览器暂停太久后，会从恢复连接重新计时。每日整枚的上限、每枚所需秒数及章节、题目奖励集中在[奖励配置](./src/modules/wallet/config.js)。调节陪伴数值后，已经开始累计的日期沿用当日规则。

希望一次复验跨日、并发与余额核对时，可在项目根目录运行 `npm.cmd test`，使用隔离数据库，约数秒完成。

## 登录与文件验收

| 操作 | 预期结果 |
| --- | --- |
| 用未登录的浏览器打开首页，或用无痕窗口打开 `/novels` | 只见一个口令框。首页登录进入菜单，从小说直链登录则返回小说。 |
| 在两个独立浏览器会话分别输入她和你的暗号 | 标签页均为 `FUTARI`。可在菜单、小说、Puzzle、新闻之间切换。她直接打开 `/admin` 得到 403，你可从「个人 → 管理」进入。 |
| 在日常页面按 `Esc`，再将窗口缩窄至手机宽度 | 页面保持在当前栏目，游戏不会出现。窄屏使用顶部导航。 |
| 在「个人」中退出，再访问原栏目或私有文件 | 页面回到锁屏，文件请求返回 401。服务端也撤销该设备的会话。 |
| 保持登录后关闭并重开同一浏览器 | 普通浏览器会话按 180 天有效期免登。Cookie 带 `HttpOnly`、`Secure`、`SameSite=Lax`。 |

**私有文件。** 在第二个 PowerShell 窗口写一份本地验收用的文本，然后打开[文件验收地址](http://127.0.0.1:8787/api/files/check/notes.txt)。已登录时会下载内容为 `FUTARI` 的文件，在未登录的无痕窗口打开同一地址会得到 401。

```powershell
'FUTARI' | npx.cmd wrangler r2 object put notes-files/check/notes.txt --local --pipe --content-type text/plain
```

**自动验收。** 以下命令使用隔离的 Worker、D1、R2 和临时暗号复验登录、管理权限、菜单批量保存与标记、TXT 拆章与续读、Puzzle 完成去重、新闻归档和私有附件。验收数据只写入测试实例。

兔名的回车保存、Esc 取消和拍立得联动会在真实浏览器中复验。测试使用本机 Chrome 或 Playwright Chromium。在两者都未安装的机器上，可先运行 `npx.cmd playwright-core install chromium --only-shell`。

```powershell
npm.cmd test
```

## 工程入口

- [Worker 路由](./src/index.js)统一检查页面、接口和文件会话。[路由表](./src/app/routes.js)登记四个内容栏目和独立的管理入口。
- [数据库迁移](./migrations/)定义认证、每周菜品、书籍章节、个人书签、题库与完成记录、新闻归档等表。图片和 TXT 原件通过私有 R2 读取。
- [私有文件接口](./src/shared/files.js)在 `/api/files/{key}` 接受 `GET` 与 `HEAD`。常见位图可在站内显示，其他文件按附件下载。站点响应禁止共享缓存。
- [Wrangler 配置](./wrangler.jsonc)保留本地 D1 标识。正式站使用 `--env production`，远端数据库命令还需带 `--remote`。发布前分别核对 R2 的 `r2.dev` 与自定义域名两种公开入口。[R2 公开访问设置](https://developers.cloudflare.com/r2/buckets/public-buckets/)

