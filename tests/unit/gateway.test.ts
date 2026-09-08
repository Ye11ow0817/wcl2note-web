import { afterEach, describe, expect, it, vi } from "vitest";
import { gateway, seal, unseal } from "../../server/gateway";
const env = {
  WCL_CLIENT_ID: "fixture-client",
  WCL_CLIENT_SECRET: "fixture-secret",
  SESSION_KEY: "12".repeat(32),
};
let ip = 0;
const request = (
  path: string,
  data: unknown,
  extra: Record<string, string> = {},
) =>
  new Request(`https://test.local/api/wcl/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://test.local",
      "X-WCL-Mode": "shared",
      "eo-connecting-ip": String(++ip),
      ...extra,
    },
    body: JSON.stringify(data),
  });
const payload = {
  operation: "reportFights",
  variables: { reportCode: "AbCd1234" },
};
afterEach(() => vi.unstubAllGlobals());
describe("固定网关与认证边界", () => {
  it("缺少共享配置时给出可操作错误", async () =>
    expect((await gateway(request("query", payload), {})).status).toBe(503));
  it.each([
    { ...payload, query: "arbitrary" },
    { ...payload, variables: { reportCode: "x", url: "https://evil" } },
    { operation: "other", variables: {} },
    {
      operation: "fightAbilityEvents",
      variables: {
        reportCode: "x",
        fightId: 1,
        startTime: 20,
        endTime: 1,
        hostilityType: "Enemies",
        dataType: "Casts",
      },
    },
  ])("拒绝任意/非法参数 %#", async (input) => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect((await gateway(request("query", input), env)).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
  it("拒绝跨站", async () =>
    expect(
      (
        await gateway(
          request("query", payload, { Origin: "https://elsewhere" }),
          env,
        )
      ).status,
    ).toBe(403));
  it("认证部分填写不会回退", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await gateway(
      request("session", { clientId: "x", clientSecret: "" }),
      env,
    );
    expect(r.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
  it("加密会话跨实例可解封，不含 Secret/token 明文，篡改过期失败", async () => {
    const token = {
      token: "private-access-token",
      expires: Date.now() + 60000,
    };
    const sealed = await seal(token, env);
    expect(sealed).not.toContain(token.token);
    expect(await unseal(sealed, env)).toEqual(token);
    await expect(unseal(`x${sealed}`, env)).rejects.toThrow();
    await expect(
      unseal(await seal({ ...token, expires: 0 }, env), env),
    ).rejects.toThrow();
  });
  it("自定义模式 Cookie 缺失不能静默共享回退", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(
      (
        await gateway(
          request("query", payload, { "X-WCL-Mode": "custom" }),
          env,
        )
      ).status,
    ).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });
  it("认证返回安全 Cookie，浏览器响应不含 token/Secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "unique-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        ),
      ),
    );
    const r = await gateway(
      request("session", { clientId: "abc", clientSecret: "private-secret" }),
      env,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(
      /HttpOnly; Secure; SameSite=Strict/,
    );
    const text = await r.text();
    expect(text).not.toContain("unique-token");
    expect(text).not.toContain("private-secret");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("HTTP 200 的 GraphQL errors 仍报错", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ errors: [{ message: "internal detail" }] }),
          ),
        ),
    );
    const cookie = await seal(
      { token: "custom-token", expires: Date.now() + 60000 },
      env,
    );
    const r = await gateway(
      request("query", payload, {
        "X-WCL-Mode": "custom",
        Cookie: `__Host-wcl2note=${cookie}`,
      }),
      env,
    );
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain("internal detail");
  });
  it("实例限流返回 Retry-After", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 11; i++)
      last = await gateway(
        request(
          "session",
          { clientId: "", clientSecret: "" },
          { "eo-connecting-ip": "rate-fixture" },
        ),
        env,
      );
    expect(last!.status).toBe(429);
    expect(last!.headers.has("Retry-After")).toBe(true);
  });
  it("超大请求不读取上游", async () =>
    expect(
      (
        await gateway(
          request("query", { ...payload, huge: "x".repeat(20000) }),
          env,
        )
      ).status,
    ).toBe(413));
  it("共享模式并发仅换取一次 token，不返回共享凭据", async () => {
    let tokens = 0;
    const mock = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth/token")) {
        tokens++;
        return new Response(
          JSON.stringify({
            access_token: "shared-private-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        );
      }
      return new Response(
        JSON.stringify({
          data: { reportData: { report: { startTime: 0, fights: [] } } },
        }),
      );
    });
    vi.stubGlobal("fetch", mock);
    const responses = await Promise.all([
      gateway(request("query", payload), {
        ...env,
        WCL_CLIENT_ID: "concurrency-fixture",
      }),
      gateway(request("query", payload), {
        ...env,
        WCL_CLIENT_ID: "concurrency-fixture",
      }),
    ]);
    expect(tokens).toBe(1);
    for (const r of responses) {
      expect(r.status).toBe(200);
      expect(await r.text()).not.toContain("shared-private-token");
    }
  });
});

// Reproduce EdgeOne's stream types without Node's Request body normalization.
describe("EdgeOne 请求流兼容", () => {
  const make = (chunks: unknown[]) => {
    const req = request("query", payload);
    Object.defineProperty(req, "body", {
      value: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    });
    return req;
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const padded = new Uint8Array(bytes.length + 8);
  padded.set(bytes, 4);
  it.each([
    ["ArrayBuffer", [bytes.slice(0, 9).buffer, bytes.slice(9).buffer]],
    ["string", [JSON.stringify(payload)]],
    ["Uint8Array", [bytes.slice(0, 9), bytes.slice(9)]],
    ["offset view", [new DataView(padded.buffer, 4, bytes.length)]],
  ])("正确解析 %s", async (_name, chunks) => {
    const response = await gateway(make(chunks as unknown[]), {});
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "CONFIG" } });
  });
  it("ArrayBuffer 超过 16 KiB 时拒绝", async () => {
    expect((await gateway(make([new ArrayBuffer(16385)]), {})).status).toBe(
      413,
    );
  });
  it("字符串按 UTF-8 字节数限制", async () => {
    expect((await gateway(make(["中".repeat(6000)]), {})).status).toBe(413);
  });
  it("损坏 JSON 仍然拒绝", async () => {
    const response = await gateway(
      make([new TextEncoder().encode("{").buffer]),
      {},
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "JSON" } });
  });
});
