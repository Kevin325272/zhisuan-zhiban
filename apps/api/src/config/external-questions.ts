import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";

export const EXTERNAL_QUESTION_LIMITS = {
  maxUploadBytes: 5 * 1024 * 1024,
  maxInputPixels: 20_000_000,
  maxDimension: 2_048,
  temporaryTtlMs: 24 * 60 * 60 * 1_000,
  maxTemporaryPerUser: 10,
  maxSavedPerUser: 100,
  maxSavedBytesPerUser: 250 * 1024 * 1024,
} as const;

export interface ExternalQuestionConfig {
  storageDirectory: string;
  limits: typeof EXTERNAL_QUESTION_LIMITS;
}

const defaultStorageDirectory = fileURLToPath(
  new URL("../../outputs/external-questions/", import.meta.url),
);
const webPublicDirectory = fileURLToPath(
  new URL("../../../web/public/", import.meta.url),
);
const apiRootDirectory = fileURLToPath(new URL("../../", import.meta.url));

function isWithin(candidate: string, parent: string) {
  const pathFromParent = relative(resolve(parent), resolve(candidate));
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

export function readExternalQuestionConfig(
  environment: Record<string, string | undefined> = process.env,
): ExternalQuestionConfig {
  const configured = environment.EXTERNAL_QUESTION_STORAGE_DIR?.trim();
  const storageDirectory = resolve(configured || defaultStorageDirectory);
  if (isWithin(apiRootDirectory, storageDirectory)) {
    throw new Error("EXTERNAL_QUESTION_STORAGE_DIR 必须使用独立私有目录，不能覆盖应用目录。");
  }
  if (isWithin(storageDirectory, webPublicDirectory)) {
    throw new Error("EXTERNAL_QUESTION_STORAGE_DIR 不能位于网页公开目录中。");
  }
  return { storageDirectory, limits: EXTERNAL_QUESTION_LIMITS };
}
