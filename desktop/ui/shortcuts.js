export function handleShortcut(event, invoke, shortcuts, mac = /Mac/.test(globalThis.navigator?.platform)) {
  if (event.defaultPrevented || event.isComposing) return false;
  if (mac && (event.target?.isContentEditable || event.target?.closest?.("input, textarea, select, [role=textbox]"))) return false;
  if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) return false;
  const key = (mac ? { KeyJ: "toggle", KeyK: "switch" } : { KeyQ: "toggle", KeyW: "switch" })[event.code];
  if (!key || (mac && shortcuts?.[key === "toggle" ? 0 : 1] !== (key === "toggle" ? "⌥J" : "⌥K"))) return false;
  event.preventDefault();
  if (!event.repeat) invoke("focused_shortcut", { key }).catch(console.error);
  return true;
}
