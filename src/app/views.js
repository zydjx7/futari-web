import styles from "./site.css";
import { unreadCount } from "../modules/messages/state.js";
import { loginPath, navigation } from "./routes.js";
import { h } from "../shared/content.js";
import { icon, sectionDrawing } from "./illustrations.js";

const siteName = "FUTARI";
let styleHash=2166136261;
for(let i=0;i<styles.length;i++) styleHash=Math.imul(styleHash^styles.charCodeAt(i),16777619);
export const readerCssPath="/app/reader-style."+(styleHash>>>0).toString(16)+".css";
export const readerStyles=()=>new Response(styles,{headers:{"Content-Type":"text/css; charset=utf-8"}});
const readerHead=`<script src="/app/reader-appearance.js"></script><style>html{background:#fff7f9}html[data-tone=paper]{background:#f5ecdc}html[data-tone=green]{background:#dcead9}html[data-tone=blue]{background:#e4edf5}html[data-tone=night]{color-scheme:dark;background:#262123}</style><link rel="stylesheet" href="${readerCssPath}">`;

function documentPage(content, status = 200, headers = {}, readerPrefs = false) {
  return new Response(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${siteName}</title><link rel="icon" href="data:,">${readerPrefs ? readerHead : `<style>${styles}</style>`}</head>
<body>${content}</body></html>`, {
    status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers }
  });
}

export function lockScreen(next, message = "", status = 200, headers = {}) {
  return documentPage(`<main class="lockscreen">
  <form class="unlock" method="post" action="${loginPath(next)}">
    <div class="lock-mark" aria-hidden="true"><span>${icon("ears")}</span></div>
    <h1>${siteName}</h1>
    <label class="passcode-label" for="passcode">专属暗号</label>
    <div class="passcode-row">
      <span class="lock-glyph" aria-hidden="true"></span>
      <input id="passcode" name="passcode" type="password" placeholder="输入暗号" required maxlength="512"
        autocomplete="current-password" autocapitalize="none" spellcheck="false" enterkeyhint="go" autofocus
        ${message ? 'aria-invalid="true" aria-describedby="login-message"' : ""}>
    </div>
    ${message ? `<p id="login-message" class="login-message" role="alert">${message}</p>` : ""}
    <button class="enter" type="submit">进入</button>
  </form></main>`, status, headers);
}

export async function shell(section, ctx, { title, body, meta = "", tools = "", back, script, reader = false }) {
  const role = typeof ctx === "string" ? ctx : ctx.role;
  const unread = ctx.db ? await unreadCount(ctx) : 0;
  const links = navigation.map(item => `<a href="${item.path}"${item.path === section ? ' aria-current="page"' : ""}>${icon(item.path)}${item.title}</a>`).join("");
  const manage = role === "admin" ? '<a href="/admin">管理</a>' : "";
  return documentPage(`<a class="skip" href="#content">跳到正文</a>
  <div class="workspace">
    <aside class="rail">
      <a class="brand" href="/menu" aria-label="${siteName} 首页"><span class="paper" aria-hidden="true">${icon("paper")}</span>${siteName}</a>
      <nav class="sections" aria-label="栏目">${links}</nav>
      <a class="rail-mail" data-message-link href="/messages"${ctx.db?"":" data-refresh-count"}${section==="/messages"?' aria-current="page"':""} aria-label="${unread?"消息，"+unread+" 条未读":"消息"}">${icon("mail")}<span>消息</span><b data-unread${unread?"":" hidden"}>${unread>99?"99+":unread}</b></a>
      <details class="account">
        <summary>${icon("person")}个人</summary>
        <div class="account-actions">${manage}<form method="post" action="/logout"><button>退出登录</button></form></div>
      </details>
      ${role === "her" ? `<button class="rail-ears" type="button" data-room-shortcut aria-label="打开兔窝" title="打开兔窝 · Alt+B" aria-keyshortcuts="Alt+B" aria-haspopup="dialog">${icon("ears")}</button>` : ""}
    </aside>
    <main id="content" class="content${reader ? " reading" : ""}" tabindex="-1">
      ${back ? `<a class="back" href="${h(back[0])}">${h(back[1])}</a>` : ""}
      <header class="page-heading"><div class="heading-copy"><h1>${h(title)}</h1>${meta}</div>${tools}${reader ? "" : sectionDrawing(section)}</header>
      ${body}
    </main>
  </div><script type="module" src="/app/messages.js"></script>${script ? `<script type="module" src="/app/${script}.js"></script>` : ""}
  ${role === "her" && section !== "/admin" ? '<script type="module" src="/app/presence.js"></script><script type="module" src="/app/room-launch.js"></script>' : ""}`, 200, {}, script === "reader");
}

export function turnLink(rel, url, label, title) {
  return `<a rel="${rel}" href="${h(url)}"><span>${label}</span><strong>${h(title)}</strong></a>`;
}

export function adminPage(ctx, title, body, options = {}) {
  return shell("/admin", ctx, { title, body, script: "editor", back: ["/admin", "管理"], ...options });
}

export function pageError(message, status) {
  return documentPage(`<main class="notice"><h1>${h(message)}</h1><a href="/menu">返回菜单</a></main>`, status);
}
