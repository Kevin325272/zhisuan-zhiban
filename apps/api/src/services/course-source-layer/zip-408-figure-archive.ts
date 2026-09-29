import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { posix } from "node:path";

import { Open, type CentralDirectory, type File } from "unzipper";

import { isSafe408ArchivePath, resolve408AssetPath } from "./408-course-source.js";
import type {
  SourceFigureArchive,
  StudentSourceFigureAsset,
} from "./student-source-courses.js";

async function sha256File(filePath: string) {
  const digest = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return digest.digest("hex");
}

function candidatePaths(path: string) {
  if (!isSafe408ArchivePath(path)) throw new Error("Unsafe 408 figure archive path.");
  const normalized = posix.normalize(path.replace(/^\.\//u, ""));
  return [normalized, `output/${normalized}`, resolve408AssetPath(normalized)];
}

export class Zip408FigureArchive implements SourceFigureArchive {
  private directory: Promise<CentralDirectory> | null = null;
  private archiveSha256: Promise<string> | null = null;

  constructor(private readonly archivePath: string) {}

  private loadDirectory() {
    this.directory ??= Open.file(this.archivePath);
    return this.directory;
  }

  private verifyArchive(expectedSha256: string) {
    this.archiveSha256 ??= sha256File(this.archivePath);
    return this.archiveSha256.then((actual) => {
      if (actual !== expectedSha256.toLowerCase()) {
        throw new Error("408 source archive SHA256 no longer matches PostgreSQL provenance.");
      }
    });
  }

  async open(asset: StudentSourceFigureAsset) {
    await this.verifyArchive(asset.archive_sha256);
    const directory = await this.loadDirectory();
    const files = new Map<string, File>(
      directory.files
        .filter((entry) => entry.type === "File")
        .map((entry) => [entry.path, entry]),
    );
    const file = candidatePaths(asset.archive_path)
      .map((candidate) => files.get(candidate))
      .find((candidate): candidate is File => Boolean(candidate));
    if (!file) throw new Error("Authorized 408 figure is missing from the source archive.");
    return {
      stream: file.stream(),
      content_length: file.uncompressedSize,
    };
  }
}
