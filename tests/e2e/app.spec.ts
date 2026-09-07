import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { report, enemies, friendlies } from "../fixtures/report";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/wcl/query", async (route) => {
    const { operation, variables: v } = route.request().postDataJSON();
    let data = report;
    if (operation === "fightAbilityEvents")
      data = {
        startTime: report.startTime,
        events: {
          data:
            v.dataType === "Casts"
              ? v.hostilityType === "Enemies"
                ? enemies
                : friendlies
              : v.hostilityType === "Friendlies"
                ? [
                    {
                      type:
                        v.dataType === "Buffs" ? "applybuff" : "applydebuff",
                      timestamp: 71000,
                      abilityGameID: 200,
                      targetID: 20,
                    },
                  ]
                : [],
          nextPageTimestamp: null,
        },
      };
    await route.fulfill({ json: { report: data } });
  });
  await page.goto("/");
});
test("报告 → 分组 → 跨标签 → 阶段 → 导出", async ({ page }, testInfo) => {
  await page
    .getByLabel("报告链接")
    .fill("https://cn.warcraftlogs.com/reports/AbCd1234?fight=last");
  await page.getByRole("button", { name: "加载报告" }).click();
  const skills = page.locator(".skill");
  await expect(skills).toHaveCount(2);
  await skills.first().getByRole("checkbox").check();
  await expect(page.getByLabel("MRT 预览")).toHaveValue(/裂解\(1\)/);
  if (process.env.UPDATE_SCREENSHOTS)
    await page.screenshot({
      path: `docs/screenshots/${testInfo.project.name}.png`,
      fullPage: true,
    });
  await page.getByRole("tab", { name: "Buff", exact: true }).click();
  await page.getByRole("button", { name: "友方", exact: true }).click();
  await page.locator(".skill").getByRole("checkbox").check();
  await expect(page.getByLabel("MRT 预览")).toHaveValue(/FS - 时间扭曲/);
  await page.getByRole("button", { name: /第二阶段/ }).click();
  await expect(page.getByLabel("MRT 预览")).toHaveValue(
    /# 测试首领 - 第二阶段/,
  );
  await expect(page.getByLabel("MRT 预览")).not.toHaveValue(/time:00:35/);
  const expectedNote = await page.getByLabel("MRT 预览").inputValue();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 txt" }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe("测试首领 - 第二阶段.txt");
  expect(await readFile((await file.path())!, "utf8")).toBe(
    expectedNote.replace(/\r?\n/g, "\r\n"),
  );
  await page.getByRole("button", { name: "清除全部" }).click();
  await expect(page.getByLabel("MRT 预览")).toHaveValue("");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("所有友方隐藏宠物，来源树可访问宠物实例", async ({ page }) => {
  await page.getByLabel("报告链接").fill("https://x/reports/abc?fight=1");
  await page.getByRole("button", { name: "加载报告" }).click();
  await expect(page.locator(".skill")).toHaveCount(2);
  await page.getByRole("button", { name: "友方", exact: true }).click();
  await expect(page.locator(".skill")).toHaveCount(1);
  await page.getByRole("button", { name: "水元素", exact: true }).click();
  await expect(page.locator(".skill")).toHaveCount(1);
  await expect(page.locator(".skill")).toContainText("水箭");
  await page.locator(".skill").getByRole("checkbox").check();
  await expect(page.getByLabel("MRT 预览")).toHaveValue(/time:01:17/);
});
test("不带 fight 的报告等待用户选择；新报告清空旧选择", async ({ page }) => {
  await page.getByLabel("报告链接").fill("abc");
  await page.getByRole("button", { name: "加载报告" }).click();
  await expect(page.locator(".fight-card")).toHaveCount(1);
  await expect(page.locator(".skill")).toHaveCount(0);
  await page.locator(".fight-card").click();
  await expect(page.locator(".skill")).toHaveCount(2);
  await page.locator(".skill").first().getByRole("checkbox").check();
  await page.getByRole("button", { name: "加载报告" }).click();
  await expect(page.getByLabel("MRT 预览")).toHaveValue("");
});
test("复制失败提供手动复制提示", async ({ page }) => {
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(Error("denied")) },
    }),
  );
  await page.getByLabel("报告链接").fill("https://x/reports/abc?fight=1");
  await page.getByRole("button", { name: "加载报告" }).click();
  await expect(page.locator(".skill")).toHaveCount(2);
  await page.locator(".skill").first().getByRole("checkbox").check();
  await page.getByRole("button", { name: "复制笔记" }).click();
  await expect(page.getByRole("status")).toContainText("手动复制");
});
test("迟到的旧报告不能覆盖新报告", async ({ page }) => {
  await page.route("**/api/wcl/query", async (route) => {
    const { variables: v } = route.request().postDataJSON();
    if (v.reportCode === "slow") {
      await new Promise((r) => setTimeout(r, 600));
      await route.fulfill({
        json: {
          report: {
            ...report,
            fights: [{ ...report.fights![0], name: "旧报告" }],
          },
        },
      });
    } else await route.fallback();
  });
  await page.getByLabel("报告链接").fill("slow");
  await page.getByRole("button", { name: "加载报告" }).click();
  await page.getByLabel("报告链接").fill("fast");
  await page.getByRole("button", { name: "加载报告" }).click();
  await expect(page.locator(".fight-card")).toContainText("测试首领");
  await page.waitForTimeout(700);
  await expect(page.locator(".fight-card")).not.toContainText("旧报告");
});
test("错误可恢复，认证切换清空报告", async ({ page }) => {
  await page.route("**/api/wcl/session", (route) =>
    route.fulfill({ json: { mode: "custom" } }),
  );
  await page.getByLabel("报告链接").fill("https://x/reports/abc?fight=1");
  await page.getByRole("button", { name: "加载报告" }).click();
  await expect(page.locator(".skill")).toHaveCount(2);
  await page.locator(".skill").first().getByRole("checkbox").check();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("Client ID", { exact: true }).fill("fixture-id");
  await page
    .getByLabel("Client Secret", { exact: true })
    .fill("fixture-secret");
  await page.getByRole("button", { name: "保存并认证" }).click();
  await expect(page.getByLabel("MRT 预览")).toHaveValue("");
  await expect(page.getByLabel("Client Secret", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.locator(".mode")).toContainText("自定义凭据");
});
test("来源筛选跨标签保留；全部清除包括隐藏项", async ({ page }) => {
  await page.getByLabel("报告链接").fill("https://x/reports/abc?fight=1");
  await page.getByRole("button", { name: "加载报告" }).click();
  await expect(page.locator(".skill")).toHaveCount(2);
  await page.getByRole("button", { name: "友方", exact: true }).click();
  await page.getByRole("button", { name: "玩家法师", exact: true }).click();
  await page.locator(".skill").getByRole("checkbox").check();
  await page.getByRole("tab", { name: "Buff", exact: true }).click();
  await expect(page.locator(".sources .active")).toHaveText("玩家法师");
  await page.locator(".skill").getByRole("checkbox").check();
  await page.getByRole("button", { name: "清除全部" }).click();
  await page.getByRole("tab", { name: "施法", exact: true }).click();
  await expect(page.locator(".skill").getByRole("checkbox")).not.toBeChecked();
});
