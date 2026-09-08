import { credentialSchema, querySchema } from "../src/shared/contract";
import { queries } from "./queries";
export interface Env {
  WCL_CLIENT_ID?: string;
  WCL_CLIENT_SECRET?: string;
  SESSION_KEY?: string;
}
class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: string,
  ) {
    super(message);
  }
}
type Token = { token: string; expires: number };
const shared = new Map<string, { value?: Token; pending?: Promise<Token> }>();
const buckets = new Map<string, { count: number; expires: number }>();
const cookieName = "__Host-wcl2note";
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const decode = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
async function key(env: Env) {
  if (!/^[a-fA-F0-9]{64}$/.test(env.SESSION_KEY ?? ""))
    throw new ApiError(503, "CONFIG", "尚未配置自定义会话密钥。");
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(env.SESSION_KEY!.match(/../g)!, (x) => parseInt(x, 16)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(token: Token, env: Env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(cookieName),
    },
    await key(env),
    new TextEncoder().encode(JSON.stringify(token)),
  );
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function unseal(value: string, env: Env): Promise<Token> {
  try {
    const [iv, data, ...extra] = value.split(".");
    if (extra.length) throw Error();
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(iv),
        additionalData: new TextEncoder().encode(cookieName),
      },
      await key(env),
      decode(data),
    );
    const token = JSON.parse(new TextDecoder().decode(plain)) as Token;
    if (
      typeof token.token !== "string" ||
      !token.token ||
      !Number.isFinite(token.expires) ||
      token.expires <= Date.now()
    )
      throw Error();
    return token;
  } catch {
    throw new ApiError(
      401,
      "SESSION_EXPIRED",
      "自定义凭据会话已过期，请重新认证。",
    );
  }
}
async function upstream(url: string, init: RequestInit) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: abort.signal,
      redirect: "error",
    });
    const content = await response.text();
    return new Response(content, {
      status: response.status,
      headers: response.headers,
    });
  } catch {
    throw new ApiError(502, "NETWORK", "无法连接 Warcraft Logs，请稍后重试。");
  } finally {
    clearTimeout(timer);
  }
}
async function requestToken(id: string, secret: string): Promise<Token> {
  const auth = btoa(
    String.fromCharCode(...new TextEncoder().encode(`${id}:${secret}`)),
  );
  const response = await upstream("https://cn.warcraftlogs.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok)
    throw new ApiError(
      response.status === 429 ? 429 : response.status >= 500 ? 502 : 401,
      "OAUTH",
      `Warcraft Logs 认证失败（HTTP ${response.status}）。`,
      response.headers.get("Retry-After") ?? undefined,
    );
  const data = (await response.json()) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
  };
  if (
    !data.access_token ||
    data.token_type?.toLowerCase() !== "bearer" ||
    !Number.isFinite(data.expires_in)
  )
    throw new ApiError(502, "OAUTH", "Warcraft Logs 返回了无效认证响应。");
  return {
    token: data.access_token,
    expires: Date.now() + Math.max(1, data.expires_in!) * 1000,
  };
}
async function sharedToken(env: Env) {
  const id = env.WCL_CLIENT_ID?.trim(),
    secret = env.WCL_CLIENT_SECRET?.trim();
  if (!id || !secret)
    throw new ApiError(
      503,
      "CONFIG",
      "默认共享凭据尚未配置。请在设置中使用自己的 WCL 凭据。",
    );
  const hash = encode(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`${id}:${secret}`),
      ),
    ),
  );
  let entry = shared.get(hash);
  if (!entry) {
    if (shared.size > 4) shared.clear();
    entry = {};
    shared.set(hash, entry);
  }
  if (entry.value && entry.value.expires > Date.now() + 60000)
    return entry.value.token;
  if (!entry.pending) {
    const target = entry;
    target.pending = requestToken(id, secret)
      .then((t) => ((target.value = t), t))
      .finally(() => {
        target.pending = undefined;
      });
  }
  return (await entry.pending!).token;
}
async function body(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new ApiError(415, "CONTENT_TYPE", "请使用 JSON 请求。");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "VALIDATION", "请求内容为空。");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // EdgeOne streams also return ArrayBuffer and string chunks.
    const raw: unknown = value;
    const chunk =
      typeof raw === "string"
        ? new TextEncoder().encode(raw)
        : ArrayBuffer.isView(raw)
          ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
          : raw instanceof ArrayBuffer
            ? new Uint8Array(raw)
            : undefined;
    if (!chunk) throw new ApiError(400, "BODY", "无法读取请求内容。");
    size += chunk.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw new ApiError(413, "SIZE", "请求内容过大。");
    }
    chunks.push(chunk);
  }
  const all = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) {
    all.set(chunk, pos);
    pos += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all)) as unknown;
  } catch {
    throw new ApiError(400, "JSON", "JSON 格式错误。");
  }
}
function limit(request: Request, auth: boolean) {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.expires <= now) buckets.delete(k);
  // Best-effort per-instance protection only. Configure platform-wide limits before launch.
  const ip = request.headers.get("eo-connecting-ip") ?? "unknown";
  const k = `${auth ? "auth" : "query"}:${ip}`;
  if (!buckets.has(k)) {
    if (buckets.size >= 4096)
      throw new ApiError(429, "RATE_LIMIT", "服务繁忙，请稍后重试。", "60");
    buckets.set(k, { count: 0, expires: now + 60000 });
  }
  const b = buckets.get(k)!;
  if (++b.count > (auth ? 10 : 120))
    throw new ApiError(
      429,
      "RATE_LIMIT",
      "请求过于频繁，请稍后重试。",
      String(Math.ceil((b.expires - now) / 1000)),
    );
}
export async function gateway(request: Request, env: Env): Promise<Response> {
  const requestId = crypto.randomUUID();
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Request-ID": requestId,
  });
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers });
  try {
    const path = new URL(request.url).pathname.replace(/\/$/, "");
    if (path === "/api/wcl/health" && request.method === "GET")
      return json({ ok: true, service: "wcl2note" });
    if (!["/api/wcl/query", "/api/wcl/session"].includes(path))
      throw new ApiError(404, "NOT_FOUND", "接口不存在。");
    if (
      request.method !== "POST" &&
      !(path.endsWith("/session") && request.method === "DELETE")
    )
      throw new ApiError(405, "METHOD", "请求方法不支持。");
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new ApiError(403, "ORIGIN", "仅接受本站发起的请求。");
    limit(request, path.endsWith("/session"));
    if (path.endsWith("/session")) {
      if (request.method === "DELETE") {
        headers.set(
          "Set-Cookie",
          `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
        );
        return json({ mode: "shared" });
      }
      const result = credentialSchema.safeParse(await body(request));
      if (!result.success)
        throw new ApiError(400, "VALIDATION", "凭据格式无效。");
      const { clientId, clientSecret } = result.data;
      if (!clientId && !clientSecret) {
        headers.set(
          "Set-Cookie",
          `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
        );
        return json({ mode: "shared" });
      }
      if (!clientId || !clientSecret)
        throw new ApiError(
          400,
          "VALIDATION",
          !clientId
            ? "已填写 Client Secret，但 Client ID 为空。"
            : "已填写 Client ID，但 Client Secret 为空。",
        );
      await key(env);
      const token = await requestToken(clientId, clientSecret);
      token.expires = Math.min(token.expires, Date.now() + 3600000);
      const ticket = await seal(token, env);
      if (ticket.length > 3800)
        throw new ApiError(502, "SESSION_SIZE", "WCL 会话过大，无法保存。");
      headers.set(
        "Set-Cookie",
        `${cookieName}=${ticket}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(1, Math.floor((token.expires - Date.now()) / 1000))}`,
      );
      return json({ mode: "custom", expires: token.expires });
    }
    const parsed = querySchema.safeParse(await body(request));
    if (!parsed.success)
      throw new ApiError(400, "VALIDATION", "查询参数无效。");
    const { operation, variables } = parsed.data;
    if (
      operation === "fightAbilityEvents" &&
      variables.endTime < variables.startTime
    )
      throw new ApiError(400, "VALIDATION", "时间范围无效。");
    const mode = request.headers.get("X-WCL-Mode");
    if (mode !== "shared" && mode !== "custom")
      throw new ApiError(400, "MODE", "请选择认证模式。");
    const ticket = request.headers
      .get("cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    const token =
      mode === "custom"
        ? (await unseal(ticket ?? "", env)).token
        : await sharedToken(env);
    const upstreamVariables =
      operation === "fightAbilityEvents"
        ? {
            ...variables,
            viewOptions: variables.dataType === "Casts" ? 1 : null,
          }
        : variables;
    const response = await upstream(
      "https://cn.warcraftlogs.com/api/v2/client",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: queries[operation],
          variables: upstreamVariables,
        }),
      },
    );
    if (response.status === 401 && mode === "shared") shared.clear();
    if (!response.ok)
      throw new ApiError(
        response.status === 429
          ? 429
          : response.status === 401 || response.status === 403
            ? response.status
            : 502,
        "UPSTREAM",
        `Warcraft Logs 请求失败（HTTP ${response.status}）。`,
        response.headers.get("Retry-After") ?? undefined,
      );
    const data = (await response.json()) as {
      errors?: unknown[];
      data?: { reportData?: { report?: unknown } };
    };
    if (data.errors?.length)
      throw new ApiError(
        502,
        "GRAPHQL",
        "Warcraft Logs 查询失败，请检查报告权限与输入。",
      );
    if (!data.data?.reportData?.report)
      throw new ApiError(404, "REPORT", "报告不存在，或当前凭据无权访问。");
    return json({ report: data.data.reportData.report });
  } catch (error) {
    const e =
      error instanceof ApiError
        ? error
        : new ApiError(502, "RESPONSE", "服务响应异常，请稍后重试。");
    if (e.retryAfter) headers.set("Retry-After", e.retryAfter);
    return json(
      { error: { code: e.code, message: e.message, requestId } },
      e.status,
    );
  }
}
