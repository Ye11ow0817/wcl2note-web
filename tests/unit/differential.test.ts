import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { formatNote } from "../../src/domain/format";
import type { Group, Options } from "../../src/domain/model";
const cases = JSON.parse(
  readFileSync(
    new URL("../fixtures/desktop-mrt.json", import.meta.url),
    "utf8",
  ),
) as {
  name: string;
  title: string;
  groups: Group[];
  options: Options;
  expected: string;
}[];
it.each(cases)("desktop output: $name", (c) =>
  expect(formatNote(c.title, c.groups, c.options).replace(/\r\n/g, "\n")).toBe(
    c.expected.replace(/\r\n/g, "\n"),
  ),
);
