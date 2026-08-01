#!/usr/bin/env node

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const apiUrl = (process.env.APP_OPPORTUNITIES_API_URL || "").replace(/\/$/, "");
const accessKey = process.env.APP_OPPORTUNITIES_ACCESS_KEY || "";
if (!apiUrl || !accessKey) {
  throw new Error("Set APP_OPPORTUNITIES_API_URL and APP_OPPORTUNITIES_ACCESS_KEY before installing.");
}

const escapeXml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const runner = resolve(scriptDirectory, "sync-app-opportunities.mjs");
const supportDirectory = resolve(homedir(), "Library", "Application Support", "DuPortfolioOpportunityRadar");
const launchAgentsDirectory = resolve(homedir(), "Library", "LaunchAgents");
const logsDirectory = resolve(supportDirectory, "logs");
const plistPath = resolve(launchAgentsDirectory, "com.dunapant.app-opportunities.plist");
const label = "com.dunapant.app-opportunities";

await mkdir(logsDirectory, { recursive: true });
await mkdir(launchAgentsDirectory, { recursive: true });

const optionalEnvironment = [
  "ASTRO_MCP_URL",
  "APP_OPPORTUNITIES_COUNTRIES",
  "APP_OPPORTUNITIES_COUNTRIES_PER_RUN",
  "APP_OPPORTUNITIES_APPS_PER_COUNTRY",
  "APP_OPPORTUNITIES_RESULTS_PER_COUNTRY",
].filter((name) => process.env[name]);

const environment = [
  ["APP_OPPORTUNITIES_API_URL", apiUrl],
  ["APP_OPPORTUNITIES_ACCESS_KEY", accessKey],
  ...optionalEnvironment.map((name) => [name, process.env[name]]),
].map(([name, value]) => `      <key>${escapeXml(name)}</key>\n      <string>${escapeXml(value)}</string>`).join("\n");

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${escapeXml(process.execPath)}</string>
      <string>${escapeXml(runner)}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
${environment}
    </dict>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key><integer>7</integer>
      <key>Minute</key><integer>15</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${escapeXml(resolve(logsDirectory, "stdout.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(resolve(logsDirectory, "stderr.log"))}</string>
  </dict>
</plist>
`;

await writeFile(plistPath, plist, { mode: 0o600 });
await chmod(plistPath, 0o600);
const domain = `gui/${process.getuid()}`;
spawnSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
const loaded = spawnSync("launchctl", ["bootstrap", domain, plistPath], { encoding: "utf8" });
if (loaded.status !== 0) throw new Error(loaded.stderr || "launchctl could not install the daily agent.");
console.log(`Installed ${label}. It runs every day at 07:15.`);
console.log(`Logs: ${logsDirectory}`);
