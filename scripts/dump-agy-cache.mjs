import { readFileSync, existsSync } from "fs";
import { join } from "path";
import os from "os";
import { homedir } from "os";

const cachePath = join(homedir(), ".gemini", "tmp", "real_quota_cache.json");

if (!existsSync(cachePath)) {
  console.error("Cache file not found at:", cachePath);
  process.exit(1);
}

const raw = readFileSync(cachePath, "utf8");
const data = JSON.parse(raw);

console.log(JSON.stringify(data, null, 2));
