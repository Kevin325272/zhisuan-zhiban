import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  ExternalQuestionImageError,
  ExternalQuestionImageService,
} from "../src/services/external-questions/image-service.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "xuetu-external-question-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

async function expectImageError(
  operation: Promise<unknown>,
  code: string,
) {
  await expect(operation).rejects.toMatchObject({ code });
}

describe("external question image service", () => {
  it("normalizes an uploaded image into a private metadata-free WebP", async () => {
    const storageDirectory = await temporaryDirectory();
    const source = await sharp({
      create: {
        width: 3_000,
        height: 1_500,
        channels: 3,
        background: "white",
      },
    })
      .withMetadata({ orientation: 6, density: 300 })
      .jpeg()
      .toBuffer();
    const service = new ExternalQuestionImageService({ storageDirectory });

    const normalized = await service.normalize({
      bytes: source,
      declaredMimeType: "image/jpeg",
      originalName: "../../private-question.jpg",
    });

    expect(normalized).toMatchObject({
      mimeType: "image/webp",
      width: 1_024,
      height: 2_048,
    });
    expect(normalized.storageRef).toMatch(/^[a-f0-9-]+\.webp$/u);
    expect(normalized.storageRef).not.toContain("private-question");
    expect(normalized.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(normalized.byteSize).toBeGreaterThan(0);

    const outputPath = join(storageDirectory, normalized.storageRef);
    await expect(stat(outputPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
    const metadata = await sharp(await readFile(outputPath)).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  it("rejects a declared MIME type that disagrees with the decoded image", async () => {
    const storageDirectory = await temporaryDirectory();
    const source = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "red" },
    }).png().toBuffer();
    const service = new ExternalQuestionImageService({ storageDirectory });

    await expectImageError(service.normalize({
      bytes: source,
      declaredMimeType: "image/jpeg",
      originalName: "question.jpg",
    }), "IMAGE_TYPE_MISMATCH");
  });

  it("rejects unsupported, corrupt, oversized and over-pixel inputs", async () => {
    const storageDirectory = await temporaryDirectory();
    const strictService = new ExternalQuestionImageService({
      storageDirectory,
      maxUploadBytes: 100,
      maxInputPixels: 10_000,
    });

    await expectImageError(strictService.normalize({
      bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
      declaredMimeType: "image/svg+xml",
      originalName: "question.svg",
    }), "IMAGE_TYPE_UNSUPPORTED");

    await expectImageError(strictService.normalize({
      bytes: Buffer.from("not-an-image"),
      declaredMimeType: "image/png",
      originalName: "question.png",
    }), "IMAGE_INVALID");

    await expectImageError(strictService.normalize({
      bytes: Buffer.alloc(101, 1),
      declaredMimeType: "image/png",
      originalName: "question.png",
    }), "IMAGE_TOO_LARGE");

    const overPixels = await sharp({
      create: { width: 200, height: 200, channels: 3, background: "white" },
    }).png().toBuffer();
    const pixelLimitedService = new ExternalQuestionImageService({
      storageDirectory,
      maxUploadBytes: 1024 * 1024,
      maxInputPixels: 10_000,
    });
    await expectImageError(pixelLimitedService.normalize({
      bytes: overPixels,
      declaredMimeType: "image/png",
      originalName: "question.png",
    }), "IMAGE_PIXEL_LIMIT");
  });

  it("rejects an oversized normalized WebP before writing a private file", async () => {
    const storageDirectory = await temporaryDirectory();
    const width = 512;
    const height = 512;
    const pixels = Buffer.alloc(width * height * 3);
    for (let index = 0; index < pixels.length; index += 1) {
      pixels[index] = (index * 37 + Math.floor(index / 97) * 13) % 256;
    }
    const source = await sharp(pixels, {
      raw: { width, height, channels: 3 },
    }).jpeg({ quality: 1 }).toBuffer();
    expect(source.byteLength).toBeLessThan(20_000);
    const service = new ExternalQuestionImageService({
      storageDirectory,
      maxUploadBytes: 20_000,
    });

    await expectImageError(service.normalize({
      bytes: source,
      declaredMimeType: "image/jpeg",
      originalName: "compressed-question.jpg",
    }), "IMAGE_TOO_LARGE");
    await expect(readdir(storageDirectory)).resolves.toEqual([]);
  });

  it("removes normalized files idempotently without accepting path traversal", async () => {
    const storageDirectory = await temporaryDirectory();
    const source = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "blue" },
    }).webp().toBuffer();
    const service = new ExternalQuestionImageService({ storageDirectory });
    const normalized = await service.normalize({
      bytes: source,
      declaredMimeType: "image/webp",
      originalName: "question.webp",
    });

    await expect(service.remove(normalized.storageRef)).resolves.toBe(true);
    await expect(service.remove(normalized.storageRef)).resolves.toBe(false);
    await expectImageError(service.read("../secret.webp"), "IMAGE_REFERENCE_INVALID");
  });
});
