import type { Query } from "../shared/contract";
import type { EventType, Fight, Report, TimelineEvent } from "../domain/model";
import { mapEvents } from "../domain/group";
import { reportSchema } from "./dto";
export type Mode = "shared" | "custom";
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfter: number = 0,
  ) {
    super(message);
  }
}
async function requestJson(
  path: string,
  init: RequestInit,
  signal: AbortSignal,
) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(
    () => controller.abort(new DOMException("请求超时", "TimeoutError")),
    30000,
  );
  try {
    return await jsonResponse(
      await fetch(path, { ...init, signal: controller.signal }),
    );
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted)
      throw new RequestError("请求超时，请重试。", 504, "NETWORK");
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
async function jsonResponse(response: Response) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new RequestError(
      "服务器未返回有效 JSON，请确认 Pages 函数已部署。",
      response.status,
      "JSON",
    );
  }
  if (!response.ok)
    throw new RequestError(
      data.error?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      data.error?.code ?? "HTTP",
      Math.min(
        30000,
        Math.max(0, Number(response.headers.get("Retry-After")) * 1000 || 0),
      ),
    );
  return data;
}
export async function query(
  payload: Query,
  mode: Mode,
  signal: AbortSignal,
): Promise<Report> {
  const data = await requestJson(
    "/api/wcl/query",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-WCL-Mode": mode },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    },
    signal,
  );
  const parsed = reportSchema.safeParse(data.report);
  if (!parsed.success)
    throw new RequestError(
      "Warcraft Logs 响应格式异常，已停止加载。",
      502,
      "REPORT",
    );
  const report = parsed.data;
  if (
    payload.operation !== "fightAbilityEvents" &&
    !Array.isArray(report.fights)
  )
    throw new RequestError("响应缺少战斗列表。", 502, "REPORT");
  if (payload.operation === "fightContext" && !report.masterData)
    throw new RequestError("响应缺少参与者目录。", 502, "REPORT");
  if (
    payload.operation === "fightSegments" &&
    !report.fights?.some((f) => f.id === payload.variables.fightId)
  )
    throw new RequestError("报告中不存在此战斗。", 404, "REPORT");
  if (report.fights)
    report.fights = report.fights.map((f) => ({
      ...f,
      name: f.name ?? `战斗 ${f.id}`,
    }));
  if (report.masterData) {
    report.masterData.actors = report.masterData.actors.map((a) => ({
      ...a,
      name: a.name ?? `未知角色 ${a.id}`,
    }));
    report.masterData.abilities = report.masterData.abilities.map((a) => ({
      ...a,
      name: a.name ?? `未知技能 ${a.gameID}`,
    }));
  }
  return report as unknown as Report;
}
export async function session(
  clientId: string,
  clientSecret: string,
  signal: AbortSignal,
): Promise<{ mode: Mode; expires?: number }> {
  return requestJson(
    "/api/wcl/session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ clientId, clientSecret }),
    },
    signal,
  );
}
export async function allEvents(
  code: string,
  fight: Fight,
  context: Report,
  type: EventType,
  mode: Mode,
  signal: AbortSignal,
): Promise<TimelineEvent[]> {
  const output: TimelineEvent[] = [];
  // Sequential side/page requests avoid multiplying WCL quota use. React Query retries only boundedly.
  for (const hostilityType of ["Friendlies", "Enemies"] as const) {
    let cursor = fight.startTime,
      pages = 0;
    while (cursor <= fight.endTime) {
      signal.throwIfAborted();
      if (++pages > 10000)
        throw new RequestError(
          "分页数异常，已停止加载，未导出不完整数据。",
          502,
          "PAGES",
        );
      const page = await query(
        {
          operation: "fightAbilityEvents",
          variables: {
            reportCode: code,
            fightId: fight.id,
            startTime: cursor,
            endTime: fight.endTime,
            hostilityType,
            dataType: type,
          },
        },
        mode,
        signal,
      );
      if (!Array.isArray(page.events?.data))
        throw new RequestError(
          "Warcraft Logs 返回的事件数据不是数组。",
          502,
          "EVENTS",
        );
      output.push(
        ...mapEvents(
          page.events.data,
          type,
          context,
          fight,
          hostilityType === "Friendlies" ? "friendly" : "enemy",
        ),
      );
      const next = page.events.nextPageTimestamp;
      if (next == null) break;
      if (!Number.isFinite(next) || next <= cursor)
        throw new RequestError(
          "Warcraft Logs 返回了无效下一页时间戳，已停止翻页。",
          502,
          "CURSOR",
        );
      cursor = next;
    }
  }
  return output.sort((a, b) => a.timestamp - b.timestamp);
}
