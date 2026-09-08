import assert from "node:assert/strict";
import { onRequest } from "../.edge-build/api/wcl/[[path]].js";

const health = await onRequest({
  request: new Request("https://fixture.local/api/wcl/health"),
  env: {},
});
assert.equal(health.status, 200);
assert.equal((await health.json()).service, "wcl2note");
assert.equal(health.headers.get("Cache-Control"), "no-store");

const invalid = await onRequest({
  request: new Request("https://fixture.local/api/wcl/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://fixture.local",
    },
    body: JSON.stringify({ operation: "arbitraryGraphQL", query: "{}" }),
  }),
  env: {},
});
assert.equal(invalid.status, 400);
assert.ok(invalid.headers.get("X-Request-ID"));
console.log(
  "Built EdgeOne handler smoke passed (local Web API runtime, no upstream call).",
);
