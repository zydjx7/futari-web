export function desktopCard(packages, el, browser = navigator) {
  const available = ["windows", "macos"].filter(id => packages?.[id]?.ready);
  const card = el("section", undefined, "desktop-postcard");
  card.append(el("h4", "把焦糖兔带去电脑桌面"));
  if (/Android|iPhone|iPad|Mobile/i.test(browser.userAgent) || (/Mac/.test(browser.platform) && browser.maxTouchPoints > 1)) {
    card.append(el("p", "在电脑浏览器打开即可下载桌宠版。"));
    return card;
  }
  if (/Macintosh|Mac OS/.test(browser.userAgent)) available.reverse();
  for (const id of available) {
    const windows = id === "windows", pkg = packages[id];
    const link = el("a", "一键下载 " + (windows ? "Windows" : "macOS") + " 桌宠（" + (pkg.size / 1048576).toFixed(1) + " MiB）");
    link.href = pkg.url;
    link.download = "";
    card.append(link, el("p", windows ? "解压后双击 FUTARI Desktop.exe。首次若见蓝色保护提示，点「更多信息 → 仍要运行」。" : "解压后将 FUTARI Desktop.app 拖入应用程序，首次按住 Control 键点按应用，选择「打开」。"),
      el("p", windows ? "平时按 Alt + Q 随时隐身或唤回。" : "按住 Option，再按 J 切换兔子层级（⌥J），按 K 开关壁纸（⌥K）。在其他应用中也可使用；若组合键已被占用，可从菜单栏的兔子图标操作。"));
  }
  const source = el("a", "获取源码与构建说明（GitHub）");
  source.href = "https://github.com/zydjx7/futari-desktop#从源码构建";
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  card.append(source);
  return card;
}
