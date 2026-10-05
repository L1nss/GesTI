const API_URL = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const TOKEN_KEY = "tigest-supabase-access-token";

export const supabaseEnabled = Boolean(API_URL && PUBLISHABLE_KEY);
export const supabaseProjectUrl = API_URL;

const storedToken = () => {
  try { return window.localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
};
const saveToken = (token) => {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* local auth remains available */ }
};

async function request(path, { method = "GET", body, token = storedToken(), headers = {} } = {}) {
  if (!supabaseEnabled) throw new Error("A conexão Supabase não está configurada.");
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${token || PUBLISHABLE_KEY}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json", Prefer: "return=representation" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : null; } catch { value = text; }
  if (!response.ok) throw new Error(value?.msg || value?.message || value?.error_description || value?.hint || `Supabase respondeu ${response.status}.`);
  return value;
}

export async function supabaseSignIn(email, password) {
  const session = await request("/auth/v1/token?grant_type=password", { method: "POST", token: PUBLISHABLE_KEY, body: { email, password } });
  saveToken(session.access_token);
  return session;
}

export async function supabaseSignUp(email, password, displayName) {
  const result = await request("/auth/v1/signup", { method: "POST", token: PUBLISHABLE_KEY, body: { email, password, data: { display_name: displayName } } });
  if (result.access_token) saveToken(result.access_token);
  return result;
}

export async function supabaseSignOut() {
  try { if (storedToken()) await request("/auth/v1/logout", { method: "POST" }); } finally { saveToken(""); }
}
export async function supabaseGetUser() {
  return request("/auth/v1/user");
}

export async function restSelect(table, filters = "") {
  return request(`/rest/v1/${encodeURIComponent(table)}?select=*${filters ? `&${filters}` : ""}`);
}
export async function restInsert(table, rows, { upsert = false, onConflict = "", returnRepresentation = true } = {}) {
  const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
  const prefer = upsert ? `resolution=merge-duplicates,return=${returnRepresentation ? "representation" : "minimal"}` : returnRepresentation ? "return=representation" : "return=minimal";
  return request(`/rest/v1/${encodeURIComponent(table)}${query}`, { method: "POST", body: rows, headers: { Prefer: prefer } });
}
export async function restUpdate(table, filters, changes) {
  return request(`/rest/v1/${encodeURIComponent(table)}?${filters}`, { method: "PATCH", body: changes });
}
export async function restDelete(table, filters) {
  return request(`/rest/v1/${encodeURIComponent(table)}?${filters}`, { method: "DELETE" });
}
export async function restRpc(name, args) {
  return request(`/rest/v1/rpc/${encodeURIComponent(name)}`, { method: "POST", body: args });
}

export async function askWorkspaceAssistant(companyId, messages) {
  const token = storedToken();
  if (!supabaseEnabled || !token) throw new Error("Entre em uma empresa conectada ao Supabase para usar o assistente.");
  const response = await fetch(`${API_URL}/functions/v1/tigest-assistant`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ companyId, messages }),
  });
  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : {}; } catch { result = {}; }
  if (!response.ok) throw new Error(result.error || "O assistente não conseguiu responder agora.");
  return String(result.answer || "Não encontrei uma resposta nos dados disponíveis.");
}

const sanitize = (value, maxLength) => String(value || "").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]").replace(/(password|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, maxLength);

export async function captureAppError(error, companyId = null) {
  if (!supabaseEnabled || !storedToken()) return;
  const row = {
    company_id: companyId,
    error_name: sanitize(error?.name || "Error", 120),
    message: sanitize(error?.message || error, 1000),
    route: sanitize(window.location.hash, 120),
    stack: sanitize(error?.stack || "", 1800),
  };
  try { await restInsert("app_errors", row); } catch { /* telemetry must never block the UI */ }
}

export async function writeAuditEvent(companyId, actorUserId, action, entityType, entityId, details = {}) {
  if (!supabaseEnabled || !storedToken()) return;
  try {
    await restInsert("audit_events", { company_id: companyId, actor_user_id: actorUserId, action, entity_type: entityType, entity_id: entityId || null, details });
  } catch { /* legacy/local audit remains the fallback */ }
}

export function hasSupabaseSession() { return Boolean(storedToken()); }
