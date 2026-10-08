const API_URL = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const AUTH_REDIRECT_URL = "https://www.gesti.sbs/";
const TOKEN_KEY = "tigest-supabase-access-token";
const SESSION_KEY = "tigest-supabase-auth-session";

export const supabaseEnabled = Boolean(API_URL && PUBLISHABLE_KEY);
export const supabaseProjectUrl = API_URL;

const storedToken = () => {
  try { return JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || "null")?.access_token || ""; } catch { return ""; }
};
const savedSession = () => {
  try { return JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
};
const saveSession = (session) => {
  try {
    if (session?.access_token) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token || savedSession()?.refresh_token || "",
      expires_at: Date.now() + Number(session.expires_in || 3600) * 1000,
    }));
    else window.sessionStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* local auth remains available */ }
};

let refreshPromise;
async function activeToken() {
  const session = savedSession();
  if (!session?.access_token) return "";
  if (!session.expires_at || session.expires_at > Date.now() + 60_000) return session.access_token;
  if (!session.refresh_token) { saveSession(null); return ""; }
  if (!refreshPromise) {
    refreshPromise = request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST", token: PUBLISHABLE_KEY, body: { refresh_token: session.refresh_token },
    }).then((next) => { saveSession(next); return next.access_token; })
      .catch((error) => { saveSession(null); throw error; })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function request(path, { method = "GET", body, token, headers = {} } = {}) {
  if (!supabaseEnabled) throw new Error("A conexão Supabase não está configurada.");
  const bearer = token === undefined ? await activeToken() : token;
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        apikey: PUBLISHABLE_KEY,
        // Publishable keys identify the project via `apikey`; they are not JWTs.
        // Only send Authorization when we have an actual user access token.
        ...(bearer && bearer !== PUBLISHABLE_KEY ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json", Prefer: "return=representation" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    if (cause instanceof TypeError) {
      throw new Error("Não foi possível conectar ao Supabase. Verifique a conexão, o CORS e se a função está publicada.", { cause });
    }
    throw cause;
  }
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : null; } catch { value = text; }
  if (!response.ok) {
    const message = value?.msg || value?.message || value?.error_description || value?.hint;
    // Ajuda a localizar falhas de configuração sem expor URL, query params ou credenciais.
    const endpoint = path.split("?")[0].replace(/^\//, "");
    throw new Error(message || `Supabase respondeu ${response.status} em ${endpoint}.`);
  }
  return value;
}

export async function supabaseSignIn(email, password) {
  const session = await request("/auth/v1/token?grant_type=password", { method: "POST", token: PUBLISHABLE_KEY, body: { email, password } });
  saveSession(session);
  return session;
}

export async function supabaseSignUp(email, password, displayName) {
  const result = await request("/auth/v1/signup", { method: "POST", token: PUBLISHABLE_KEY, body: { email, password, data: { display_name: displayName } } });
  if (result.access_token) saveSession(result);
  return result;
}

export function supabaseConsumePasswordlessLink() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const type = params.get("type");
  if (!params.get("access_token") || !["magiclink", "signup", "email"].includes(type || "")) return false;
  saveSession({ access_token: params.get("access_token"), refresh_token: params.get("refresh_token"), expires_in: Number(params.get("expires_in") || 3600) });
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return true;
}

export async function supabaseUpdateCurrentPassword(password) {
  await request("/auth/v1/user", { method: "PUT", body: { password } });
}

export async function supabaseRegisterEmployee(employee) {
  return request("/functions/v1/register-employee", { method: "POST", body: employee });
}

export async function supabaseClaimEmployeeRegistration(claim) {
  return request("/functions/v1/claim-employee-registration", { method: "POST", token: PUBLISHABLE_KEY, body: claim });
}

export async function supabaseSignOut() {
  try { if (storedToken()) await request("/auth/v1/logout", { method: "POST" }); } finally { saveSession(null); }
}
export async function supabaseUpdatePassword(email, currentPassword, newPassword) {
  await request("/auth/v1/token?grant_type=password", { method: "POST", token: PUBLISHABLE_KEY, body: { email, password: currentPassword } });
  await request("/auth/v1/user", { method: "PUT", body: { password: newPassword } });
}
export async function supabaseSendPasswordReset(email) {
  const redirect = encodeURIComponent(AUTH_REDIRECT_URL);
  await request(`/auth/v1/recover?redirect_to=${redirect}`, { method: "POST", token: PUBLISHABLE_KEY, body: { email } });
}
export function supabaseConsumeRecoveryLink() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (params.get("type") !== "recovery" || !params.get("access_token")) return false;
  saveSession({
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
    expires_in: Number(params.get("expires_in") || 3600),
  });
  try { window.localStorage.removeItem("tigest-session-v2"); } catch { /* armazenamento indisponível */ }
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return true;
}
export async function supabaseCompleteRecovery(newPassword) {
  if (!hasSupabaseSession()) throw new Error("O link de recuperação expirou. Solicite outro.");
  await request("/auth/v1/user", { method: "PUT", body: { password: newPassword } });
  saveSession(null);
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
  const token = await activeToken();
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

export function hasSupabaseSession() { return Boolean(savedSession()?.access_token); }
