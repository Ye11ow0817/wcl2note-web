import { afterEach, expect, it, vi } from "vitest";
import { allEvents } from "../../src/infrastructure/client";
import { report, enemies } from "../fixtures/report";
afterEach(() => vi.unstubAllGlobals());
it("友敌两侧均完成分页", async () => {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      calls++;
      const v = JSON.parse(init.body).variables;
      const enemy = v.hostilityType === "Enemies";
      return new Response(
        JSON.stringify({
          report: {
            events: {
              data: enemy ? [enemies[v.startTime === 1000 ? 0 : 1]] : [],
              nextPageTimestamp: enemy && v.startTime === 1000 ? 60000 : null,
            },
          },
        }),
      );
    }),
  );
  const events = await allEvents(
    "abc",
    report.fights![0],
    report,
    "Casts",
    "shared",
    new AbortController().signal,
  );
  expect(events).toHaveLength(2);
  expect(calls).toBe(3);
});
it("重复游标报错，不能导出第一页冒充完整结果", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            report: { events: { data: [], nextPageTimestamp: 1000 } },
          }),
        ),
    ),
  );
  await expect(
    allEvents(
      "abc",
      report.fights![0],
      report,
      "Casts",
      "shared",
      new AbortController().signal,
    ),
  ).rejects.toThrow("下一页");
});
it("取消后不再发起下一页", async () => {
  const c = new AbortController();
  c.abort();
  const spy = vi.fn();
  vi.stubGlobal("fetch", spy);
  await expect(
    allEvents("abc", report.fights![0], report, "Casts", "shared", c.signal),
  ).rejects.toThrow();
  expect(spy).not.toHaveBeenCalled();
});
