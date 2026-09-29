import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  EXTERNAL_QUESTION_LIMITS,
  readExternalQuestionConfig,
} from "../src/config/external-questions.js";

describe("external question configuration", () => {
  it("uses private bounded defaults", () => {
    const config = readExternalQuestionConfig({});
    expect(config.storageDirectory.replaceAll("\\", "/")).toMatch(
      /\/apps\/api\/outputs\/external-questions$/u,
    );
    expect(config.limits).toEqual(EXTERNAL_QUESTION_LIMITS);
  });

  it("rejects storage inside source or public application directories", () => {
    const apiRoot = fileURLToPath(new URL("../", import.meta.url));
    const webPublic = fileURLToPath(new URL("../../web/public/", import.meta.url));

    expect(() => readExternalQuestionConfig({
      EXTERNAL_QUESTION_STORAGE_DIR: apiRoot,
    })).toThrow(/独立私有目录/u);
    expect(() => readExternalQuestionConfig({
      EXTERNAL_QUESTION_STORAGE_DIR: webPublic,
    })).toThrow(/公开目录/u);
  });
});
