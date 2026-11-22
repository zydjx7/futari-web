// Apply stored paper and text size in the head, before the first paint.
(() => {
  let tone, size;
  try {
    tone = localStorage.getItem("futari.reader.tone");
    size = localStorage.getItem("futari.reader.size");
  } catch { /* Storage is optional. */ }
  const root = document.documentElement;
  root.dataset.tone = ["blush", "paper", "green", "blue", "night"].includes(tone) ? tone : "blush";
  root.dataset.size = ["xs", "small", "medium", "large", "xl"].includes(size) ? size : "medium";
})();
