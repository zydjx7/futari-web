export const archives = {
  windows: "downloads/FUTARI-Desktop-Windows-x64.zip",
  macos: "downloads/FUTARI-Desktop-macOS.zip"
};
export async function downloads(bucket) {
  const entries = await Promise.all(Object.entries(archives).map(async ([platform, key]) => {
    const object = await bucket.head(key);
    return [platform, { ready: !!object, size: object?.size ?? 0, url: object ? "/api/files/" + key : null }];
  }));
  return Response.json(Object.fromEntries(entries), { headers: { "Cache-Control": "private, no-store" } });
}
