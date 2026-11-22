export function redirect(location, status = 302, headers = {}) {
  return new Response(null, { status, headers: { Location: location, ...headers } });
}

export function saved(ctx, location) {
  return ctx.request.headers.get("Accept")?.includes("application/json")
    ? Response.json({ location }) : redirect(location, 303);
}

export function plain(message, status, headers = {}) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
}

export function secureHeaders(response) {
  const headers = response.headers;
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Referrer-Policy", "same-origin");
  if (!headers.has("Content-Security-Policy")) {
    headers.set("Content-Security-Policy",
      "default-src 'none'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; " +
      "form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  }
  return response;
}
