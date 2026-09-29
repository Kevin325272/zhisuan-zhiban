import { describe, expect, it, vi } from "vitest";

import { runExternalQuestionCleanupBatch } from "../src/services/external-questions/cleanup.js";
import type {
  ExternalQuestionCleanupRef,
  ExternalQuestionRepository,
} from "../src/services/external-questions/external-question.js";

const now = new Date("2026-08-24T08:00:00.000Z");
const first: ExternalQuestionCleanupRef = {
  externalQuestionId: "external_question_001",
  storageRef: "93cf786f-0348-4d75-a981-19d5ef9b46ab.webp",
};
const second: ExternalQuestionCleanupRef = {
  externalQuestionId: "external_question_002",
  storageRef: "4d23af49-c877-42ca-812f-2ff0464534cb.webp",
};

function repository(overrides: Partial<ExternalQuestionRepository> = {}) {
  return {
    findCleanupBatch: vi.fn().mockResolvedValue([first, second]),
    finalizeCleanup: vi.fn().mockResolvedValue(true),
    releaseCleanup: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as ExternalQuestionRepository;
}

describe("external-question cleanup", () => {
  it("claims a bounded batch, removes files and finalizes matching references", async () => {
    const repo = repository();
    const remove = vi.fn().mockResolvedValue(true);

    await expect(runExternalQuestionCleanupBatch({
      repository: repo,
      imageService: { remove },
      now,
      limit: 20,
    })).resolves.toEqual({ claimed: 2, finalized: 2, released: 0 });

    expect(repo.findCleanupBatch).toHaveBeenCalledWith(now, 20);
    expect(remove).toHaveBeenNthCalledWith(1, first.storageRef);
    expect(remove).toHaveBeenNthCalledWith(2, second.storageRef);
    expect(repo.finalizeCleanup).toHaveBeenNthCalledWith(1, { ...first, now });
    expect(repo.finalizeCleanup).toHaveBeenNthCalledWith(2, { ...second, now });
    expect(repo.releaseCleanup).not.toHaveBeenCalled();
  });

  it("releases only the failed file claim and reports a bounded failure", async () => {
    const repo = repository();
    const remove = vi.fn()
      .mockRejectedValueOnce(new Error("private path must not be logged"))
      .mockResolvedValueOnce(true);
    const onFailure = vi.fn();

    await expect(runExternalQuestionCleanupBatch({
      repository: repo,
      imageService: { remove },
      now,
      limit: 2,
      onFailure,
    })).resolves.toEqual({ claimed: 2, finalized: 1, released: 1 });

    expect(repo.releaseCleanup).toHaveBeenCalledWith(first);
    expect(onFailure).toHaveBeenCalledWith({
      code: "EXTERNAL_QUESTION_FILE_CLEANUP_FAILED",
      externalQuestionId: first.externalQuestionId,
    });
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain(first.storageRef);
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain("private path");
  });

  it("releases a claim when the file is gone but finalization did not update the row", async () => {
    const repo = repository({
      findCleanupBatch: vi.fn().mockResolvedValue([first]),
      finalizeCleanup: vi.fn().mockResolvedValue(false),
    });
    const remove = vi.fn().mockResolvedValue(false);
    const onFailure = vi.fn();

    await expect(runExternalQuestionCleanupBatch({
      repository: repo,
      imageService: { remove },
      now,
      limit: 1,
      onFailure,
    })).resolves.toEqual({ claimed: 1, finalized: 0, released: 1 });

    expect(repo.releaseCleanup).toHaveBeenCalledWith(first);
    expect(onFailure).toHaveBeenCalledWith({
      code: "EXTERNAL_QUESTION_FILE_CLEANUP_FAILED",
      externalQuestionId: first.externalQuestionId,
    });
  });

  it("rejects an unbounded batch size before touching storage", async () => {
    const repo = repository();
    await expect(runExternalQuestionCleanupBatch({
      repository: repo,
      imageService: { remove: vi.fn() },
      now,
      limit: 101,
    })).rejects.toThrow(/between 1 and 100/iu);
    expect(repo.findCleanupBatch).not.toHaveBeenCalled();
  });
});
