// api.js — tüm backend fetch çağrıları için sarmalayıcı

async function req(method, path, body) {
  const opts = {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error || res.statusText), { status: res.status });
  }
  return res.json();
}

export const api = {
  // Auth
  me:             ()      => req("GET",  "/api/auth/me"),
  login:          (u, p)  => req("POST", "/api/auth/login", { username: u, password: p }),
  logout:         ()      => req("POST", "/api/auth/logout"),
  changePassword: (c, n)  => req("POST", "/api/auth/change-password", { current: c, next: n }),

  // Dashboard
  dashboard:      ()      => req("GET",  "/api/dashboard"),

  // Signals
  getSignals:  (p = {}) => req("GET", `/api/signals?${new URLSearchParams(p)}`),
  signalStats: (since)  => req("GET", `/api/signals/stats${since ? `?since=${since}` : ""}`),

  // Reports
  getReports:   (p = {}) => req("GET", `/api/reports?${new URLSearchParams(p)}`),
  latestReport: ()       => req("GET", "/api/reports/latest"),

  // Bot
  botStatus:     ()  => req("GET",  "/api/bot/status"),
  triggerReport: ()  => req("POST", "/api/bot/trigger", {}),
  sources:       ()  => req("GET",  "/api/bot/sources"),

  // Settings
  getSettings:  ()    => req("GET",   "/api/settings"),
  saveSettings: (obj) => req("PATCH", "/api/settings", obj),

  // Signal actions
  ackSignal: (id) => req("PATCH", `/api/signals/${id}/ack`, {}),
};

export function connectSSE(handlers) {
  const es = new EventSource("/api/events");
  es.addEventListener("signal",    e => handlers.signal?.(JSON.parse(e.data)));
  es.addEventListener("report",    e => handlers.report?.(JSON.parse(e.data)));
  es.addEventListener("heartbeat", e => handlers.heartbeat?.(JSON.parse(e.data)));
  es.onerror = () => {};
  return es;
}
