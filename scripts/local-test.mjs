import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const mode = process.argv[2] ?? "dev";
if (!["dev", "test", "all"].includes(mode)) {
  console.error("Usage: local-test.cmd [dev|test|all]");
  process.exit(1);
}
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 11)) {
  console.error("Please install Node.js 22.11 or newer.");
  process.exit(1);
}
function run(args) {
  // Only fixed internal command arguments are passed to the Windows shell.
  const result =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`], {
          stdio: "inherit",
        })
      : spawnSync("npm", args, { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    console.error("Command failed; stopping.");
    process.exit(result.status || 1);
  }
}
if (!existsSync("node_modules") || mode !== "dev") run(["ci"]);
if (mode !== "dev") {
  run(["test"]);
  run(["run", "lint"]);
  run(["run", "build"]);
  if (mode === "all") run(["run", "test:e2e"]);
  console.log(
    "Local checks passed. EdgeOne deployment still needs live verification.",
  );
} else {
  const path = ".env.local";
  let env = existsSync(path)
    ? readFileSync(path, "utf8")
    : readFileSync(".env.example", "utf8");
  const keyLine = /^SESSION_KEY=.*$/m;
  const existing = env.match(keyLine)?.[0].slice("SESSION_KEY=".length).trim();
  if (!existing || existing === '""' || existing === "''") {
    const line = `SESSION_KEY=${randomBytes(32).toString("hex")}`;
    env = keyLine.test(env)
      ? env.replace(keyLine, line)
      : `${env.trimEnd()}\n${line}\n`;
    writeFileSync(path, env, { mode: 0o600 });
    console.log("Created local session key in .env.local (value hidden).");
  }
  console.log("Local URL: http://127.0.0.1:5173");
  console.log(
    "Set WCL credentials in .env.local, or enter them in the web settings.",
  );
  console.log(
    "Keep this window open. Press Ctrl+C to stop. Restart after editing .env.local.",
  );
  run(["run", "dev"]);
}
