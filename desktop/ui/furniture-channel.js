// The embedded macOS 12 WebKit can predate BroadcastChannel. Storage events
// carry the same small desktop tiles there and never persist the picture.
export function furnitureChannel(receive) {
  const topic = "futari-desktop-furnishings";
  if (typeof BroadcastChannel === "function") {
    const channel = new BroadcastChannel(topic);
    channel.onmessage = event => receive(event.data);
    return data => channel.postMessage(data);
  }
  window.addEventListener("storage", event => {
    if (event.key !== topic || !event.newValue) return;
    const data = JSON.parse(event.newValue);
    if (data.tiles) for (const tile of data.tiles) {
      const bytes = Uint8ClampedArray.from(atob(tile.bytes), char => char.charCodeAt(0));
      tile.pixels = new ImageData(bytes, tile.cols, tile.rows);
    }
    receive(data);
  });
  return data => {
    const message = data.tiles ? {tiles: data.tiles.map(({pixels, ...tile}) => {
      let raw = "";
      for (let i = 0; i < pixels.data.length; i += 8192) {
        raw += String.fromCharCode(...pixels.data.subarray(i, i + 8192));
      }
      return {...tile, cols:pixels.width, rows:pixels.height, bytes:btoa(raw)};
    })} : data;
    localStorage.setItem(topic, JSON.stringify(message));
    localStorage.removeItem(topic);
  };
}
