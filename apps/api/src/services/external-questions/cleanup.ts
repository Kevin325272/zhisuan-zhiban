import type {
  ExternalQuestionRepository,
} from "./external-question.js";

interface ExternalQuestionCleanupOptions {
  repository: Pick<
    ExternalQuestionRepository,
    "findCleanupBatch" | "finalizeCleanup" | "releaseCleanup"
  >;
  imageService: { remove(storageRef: string): Promise<boolean> };
  now: Date;
  limit?: number;
  onFailure?: (failure: {
    code: "EXTERNAL_QUESTION_FILE_CLEANUP_FAILED";
    externalQuestionId: string;
  }) => void;
}

export async function runExternalQuestionCleanupBatch(
  options: ExternalQuestionCleanupOptions,
) {
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("External-question cleanup limit must be between 1 and 100.");
  }
  const refs = await options.repository.findCleanupBatch(options.now, limit);
  let finalized = 0;
  let released = 0;
  for (const ref of refs) {
    try {
      await options.imageService.remove(ref.storageRef);
      const didFinalize = await options.repository.finalizeCleanup({
        ...ref,
        now: options.now,
      });
      if (!didFinalize) {
        throw new Error("External-question cleanup claim could not be finalized.");
      }
      finalized += 1;
    } catch {
      const didRelease = await options.repository.releaseCleanup(ref).catch(() => false);
      if (didRelease) released += 1;
      options.onFailure?.({
        code: "EXTERNAL_QUESTION_FILE_CLEANUP_FAILED",
        externalQuestionId: ref.externalQuestionId,
      });
    }
  }
  return { claimed: refs.length, finalized, released };
}
