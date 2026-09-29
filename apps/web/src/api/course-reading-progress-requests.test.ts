import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function response(data: unknown) {
  return new Response(JSON.stringify({ contract_version: "0.2", request_id: "reading-test", data }), { status: 200 });
}
const position = (index: number) => ({ chapter: "数组", chunk_id: "ds_k0114", paragraph_index: index, source_expanded: true });

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("reading progress request ordering", () => {
  it("waits for the previous write before sending a newer position", async () => {
    const firstResponse = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(firstResponse.promise).mockResolvedValue(response(position(4)));
    vi.stubGlobal("fetch", fetcher);
    const { saveCourseReadingProgress } = await import("./client");
    const first = saveCourseReadingProgress("data-structures", position(1));
    const latest = saveCourseReadingProgress("data-structures", position(4));
    expect(fetcher).toHaveBeenCalledTimes(1);
    firstResponse.resolve(response(position(1)));
    await first;
    await latest;
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(init.body).paragraph_index)).toEqual([1, 4]);
  });

  it("lets a newer write proceed after the previous request fails", async () => {
    const firstResponse = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(firstResponse.promise).mockResolvedValue(response(position(4)));
    vi.stubGlobal("fetch", fetcher);
    const { saveCourseReadingProgress } = await import("./client");
    const first = saveCourseReadingProgress("data-structures", position(1)).catch((error) => error);
    const latest = saveCourseReadingProgress("data-structures", position(4), { keepalive: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    firstResponse.reject(new Error("offline"));
    expect(await first).toBeInstanceOf(Error);
    await latest;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ keepalive: true });
  });

  it("waits for pending writes before restoring a course after navigation", async () => {
    const firstResponse = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(response(position(4))).mockResolvedValueOnce(response({ progress: position(4) }));
    vi.stubGlobal("fetch", fetcher);
    const { saveCourseReadingProgress, getCourseReadingProgress } = await import("./client");
    const first = saveCourseReadingProgress("data-structures", position(1));
    const latest = saveCourseReadingProgress("data-structures", position(4));
    const reading = getCourseReadingProgress("data-structures");
    expect(fetcher).toHaveBeenCalledTimes(1);
    firstResponse.resolve(response(position(1)));
    await Promise.all([first, latest]);
    expect(await reading).toMatchObject({ progress: { paragraph_index: 4 } });
    expect(fetcher.mock.calls.map(([, init]) => init.method ?? "GET")).toEqual(["PUT", "PUT", "GET"]);
  });

  it("does not serialize writes for different courses", async () => {
    const firstResponse = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(firstResponse.promise).mockResolvedValue(response(position(4)));
    vi.stubGlobal("fetch", fetcher);
    const { saveCourseReadingProgress } = await import("./client");
    const first = saveCourseReadingProgress("data-structures", position(1));
    await saveCourseReadingProgress("operating-systems", position(4));
    expect(fetcher).toHaveBeenCalledTimes(2);
    firstResponse.resolve(response(position(1)));
    await first;
  });

  it("releases a stuck save on abort so later positions can still be saved", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(controller.signal);
    const fetcher = vi.fn().mockImplementationOnce((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })).mockImplementation(() => Promise.resolve(response(position(4))));
    vi.stubGlobal("fetch", fetcher);
    const { saveCourseReadingProgress } = await import("./client");
    const first = saveCourseReadingProgress("data-structures", position(1)).catch((error) => error);
    const latest = saveCourseReadingProgress("data-structures", position(4));
    expect(fetcher).toHaveBeenCalledTimes(1);
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    expect(await first).toMatchObject({ name: "TimeoutError" });
    await latest;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("discards old queued positions when signing out instead of sending them with another session", async () => {
    const firstResponse = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(response({ logged_out: true })).mockImplementation(() => Promise.resolve(response(position(7))));
    vi.stubGlobal("fetch", fetcher);
    const { saveCourseReadingProgress, logoutAccount } = await import("./client");
    const first = saveCourseReadingProgress("data-structures", position(1));
    const outdated = saveCourseReadingProgress("data-structures", position(4)).catch((error) => error);
    await logoutAccount();
    const nextSession = saveCourseReadingProgress("data-structures", position(7));
    firstResponse.resolve(response(position(1)));
    await Promise.all([first, nextSession]);
    expect(await outdated).toMatchObject({ code: "READING_SESSION_CHANGED" });
    const writes = fetcher.mock.calls.filter(([, init]) => init.method === "PUT");
    expect(writes.map(([, init]) => JSON.parse(init.body).paragraph_index)).toEqual([1, 7]);
  });
});
