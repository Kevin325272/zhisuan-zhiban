import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import sharp from "sharp";

import { EXTERNAL_QUESTION_LIMITS } from "../../config/external-questions.js";

export type ExternalQuestionImageErrorCode =
  | "IMAGE_TYPE_UNSUPPORTED"
  | "IMAGE_TYPE_MISMATCH"
  | "IMAGE_INVALID"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_PIXEL_LIMIT"
  | "IMAGE_REFERENCE_INVALID"
  | "IMAGE_NOT_FOUND";

export class ExternalQuestionImageError extends Error {
  constructor(
    readonly code: ExternalQuestionImageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExternalQuestionImageError";
  }
}

interface ExternalQuestionImageServiceOptions {
  storageDirectory: string;
  maxUploadBytes?: number;
  maxInputPixels?: number;
  maxDimension?: number;
}

interface NormalizeExternalQuestionImageInput {
  bytes: Buffer;
  declaredMimeType: string;
  originalName: string;
}

export interface NormalizedExternalQuestionImage {
  storageRef: string;
  mimeType: "image/webp";
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
}

const formatMimeTypes = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function sharpErrorCode(error: unknown): ExternalQuestionImageErrorCode {
  const message = error instanceof Error ? error.message.toLocaleLowerCase() : "";
  return message.includes("pixel limit") || message.includes("input image exceeds")
    ? "IMAGE_PIXEL_LIMIT"
    : "IMAGE_INVALID";
}

export class ExternalQuestionImageService {
  readonly #storageDirectory: string;
  readonly #maxUploadBytes: number;
  readonly #maxInputPixels: number;
  readonly #maxDimension: number;

  constructor(options: ExternalQuestionImageServiceOptions) {
    this.#storageDirectory = resolve(options.storageDirectory);
    this.#maxUploadBytes = positiveInteger(
      options.maxUploadBytes ?? EXTERNAL_QUESTION_LIMITS.maxUploadBytes,
      "maxUploadBytes",
    );
    this.#maxInputPixels = positiveInteger(
      options.maxInputPixels ?? EXTERNAL_QUESTION_LIMITS.maxInputPixels,
      "maxInputPixels",
    );
    this.#maxDimension = positiveInteger(
      options.maxDimension ?? EXTERNAL_QUESTION_LIMITS.maxDimension,
      "maxDimension",
    );
  }

  async normalize(
    input: NormalizeExternalQuestionImageInput,
  ): Promise<NormalizedExternalQuestionImage> {
    const declaredMimeType = input.declaredMimeType.trim().toLocaleLowerCase();
    if (!Object.values(formatMimeTypes).includes(
      declaredMimeType as (typeof formatMimeTypes)[keyof typeof formatMimeTypes],
    )) {
      throw new ExternalQuestionImageError(
        "IMAGE_TYPE_UNSUPPORTED",
        "只支持 PNG、JPEG 或 WebP 题目图片。",
      );
    }
    if (input.bytes.byteLength > this.#maxUploadBytes) {
      throw new ExternalQuestionImageError(
        "IMAGE_TOO_LARGE",
        "题目图片超过大小限制。",
      );
    }
    if (input.bytes.byteLength === 0) {
      throw new ExternalQuestionImageError("IMAGE_INVALID", "题目图片为空。");
    }

    const metadata = await sharp(input.bytes, {
        failOn: "warning",
        limitInputPixels: this.#maxInputPixels,
      }).metadata().catch((error: unknown) => {
        const code = sharpErrorCode(error);
        throw new ExternalQuestionImageError(
          code,
          code === "IMAGE_PIXEL_LIMIT" ? "题目图片像素尺寸超过限制。" : "无法解析题目图片。",
        );
      });

    const actualMimeType = metadata.format
      ? formatMimeTypes[metadata.format as keyof typeof formatMimeTypes]
      : undefined;
    if (!actualMimeType) {
      throw new ExternalQuestionImageError(
        "IMAGE_TYPE_UNSUPPORTED",
        "只支持 PNG、JPEG 或 WebP 题目图片。",
      );
    }
    if (actualMimeType !== declaredMimeType) {
      throw new ExternalQuestionImageError(
        "IMAGE_TYPE_MISMATCH",
        "题目图片实际格式与声明格式不一致。",
      );
    }

    const normalized = await sharp(input.bytes, {
        failOn: "warning",
        limitInputPixels: this.#maxInputPixels,
      })
        .rotate()
        .resize({
          width: this.#maxDimension,
          height: this.#maxDimension,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 92, smartSubsample: true })
        .toBuffer({ resolveWithObject: true })
        .catch((error: unknown) => {
          const code = sharpErrorCode(error);
          throw new ExternalQuestionImageError(
            code,
            code === "IMAGE_PIXEL_LIMIT" ? "题目图片像素尺寸超过限制。" : "无法规范化题目图片。",
          );
        });

    if (normalized.info.size > this.#maxUploadBytes) {
      throw new ExternalQuestionImageError(
        "IMAGE_TOO_LARGE",
        "规范化后的题目图片超过大小限制。",
      );
    }

    const storageRef = `${randomUUID()}.webp`;
    await mkdir(this.#storageDirectory, { recursive: true });
    await writeFile(this.#pathFor(storageRef), normalized.data, { flag: "wx" });
    return {
      storageRef,
      mimeType: "image/webp",
      width: normalized.info.width,
      height: normalized.info.height,
      byteSize: normalized.info.size,
      sha256: createHash("sha256").update(normalized.data).digest("hex"),
    };
  }

  async read(storageRef: string) {
    const path = this.#pathFor(storageRef);
    try {
      return await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ExternalQuestionImageError("IMAGE_NOT_FOUND", "题目图片不存在。");
      }
      throw error;
    }
  }

  async remove(storageRef: string) {
    const path = this.#pathFor(storageRef);
    try {
      await rm(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  #pathFor(storageRef: string) {
    if (!/^[a-f0-9-]+\.webp$/u.test(storageRef)) {
      throw new ExternalQuestionImageError(
        "IMAGE_REFERENCE_INVALID",
        "题目图片引用无效。",
      );
    }
    const candidate = resolve(join(this.#storageDirectory, storageRef));
    if (dirname(candidate) !== this.#storageDirectory) {
      throw new ExternalQuestionImageError(
        "IMAGE_REFERENCE_INVALID",
        "题目图片引用无效。",
      );
    }
    return candidate;
  }
}
