import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(resolve(root, ".env.reproduction"));
const bin = process.env.POSTGRES_BIN || resolve(root, ".runtime", "pg", "pgsql", "bin");
const exe = (name) => resolve(bin, name + (process.platform === "win32" ? ".exe" : ""));
const env = {
  ...process.env,
  PGPASSWORD: process.env.XUETU_REPRO_DB_PASSWORD,
  PGCLIENTENCODING: "UTF8",
};
const sql = resolve(root, ".runtime", "repro-demo.sql");
if (!existsSync(sql)) throw new Error("演示数据库快照不存在：" + sql);
const result = spawnSync(exe("psql"), [
  "-h", "127.0.0.1",
  "-p", process.env.XUETU_REPRO_DB_PORT || "55435",
  "-U", process.env.XUETU_REPRO_DB_USER,
  "-d", process.env.XUETU_REPRO_DB_NAME,
  "-v", "ON_ERROR_STOP=1",
  "-f", sql,
], { encoding: "utf8", env, windowsHide: true });
if (result.status !== 0) {
  throw new Error((result.stderr || result.stdout || "演示数据库恢复失败").replaceAll(env.PGPASSWORD, "[REDACTED]"));
}
writeFileSync(resolve(root, ".runtime", ".demo-restored"), new Date().toISOString() + "\n", { encoding: "utf8" });
console.log(JSON.stringify({ restored: true, database: process.env.XUETU_REPRO_DB_NAME }));
