import { existsSync } from "node:fs";
import { resolve } from "node:path";

type EnvironmentLoader = (path: string) => void;

export function loadLocalEnvironment(
  workingDirectory = process.cwd(),
  loader: EnvironmentLoader = process.loadEnvFile,
) {
  const candidates = [
    resolve(workingDirectory, ".env.local"),
    resolve(workingDirectory, "apps/api/.env.local"),
  ];
  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (!envPath) return null;
  loader(envPath);
  return envPath;
}
