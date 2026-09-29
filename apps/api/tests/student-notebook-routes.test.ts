import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerStudentNotebookRoutes } from "../src/routes/student-notebook.js";
import { NotebookError, type StudentNotebook } from "../src/services/student-notebook.js";
import type { LocalAuthenticationService } from "../src/services/auth/authentication.js";

const input = { title: "缓存错因", content: "先拆地址", subject: "组成原理", question_id: null, bookmarked: false, version: 0 };
function fixture() {
  const app = Fastify();
  const store: StudentNotebook = { list: vi.fn().mockResolvedValue({ items: [], total: 0, notes_count: 0, bookmarks_count: 0 }), get: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue({ id: "note-1" }), remove: vi.fn().mockResolvedValue(undefined) };
  const authentication = { resolveSession: async (token: string) => token === "student" || token === "teacher" ? { account: { user_id: token, roles: [token], must_change_password: false } } : null } as unknown as LocalAuthenticationService;
  registerStudentNotebookRoutes(app, store, { authentication, allowLocalDevAuth: false });
  return { app, store };
}
describe("student notebook access and writes", () => {
  it.each([undefined, "invalid"])("rejects unauthenticated access without touching stored notes (%s)", async (token) => {
    const { app, store } = fixture();
    const r = await app.inject({ url: "/api/v1/student/notebook", headers: token ? { cookie: `xuetu_session=${token}` } : {} });
    expect(r.statusCode).toBe(401); expect(store.list).not.toHaveBeenCalled(); await app.close();
  });
  it("rejects teachers and ignores a forged user query", async () => {
    const { app, store } = fixture();
    expect((await app.inject({ url: "/api/v1/student/notebook", headers: { cookie: "xuetu_session=teacher" } })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/v1/student/notebook?user_id=another", headers: { cookie: "xuetu_session=student" } })).statusCode).toBe(400);
    expect(store.list).not.toHaveBeenCalled(); await app.close();
  });
  it("derives the owner from the server session for reading, updating and removing", async () => {
    const { app, store } = fixture(); const headers = { cookie: "xuetu_session=student" };
    await app.inject({ url: "/api/v1/student/notebook/note-1", headers });
    await app.inject({ method: "PUT", url: "/api/v1/student/notebook/note-1", headers, payload: input });
    await app.inject({ method: "DELETE", url: "/api/v1/student/notebook/note-1?version=2", headers });
    expect(store.get).toHaveBeenCalledWith("student", "note-1");
    expect(store.save).toHaveBeenCalledWith("student", "note-1", input);
    expect(store.remove).toHaveBeenCalledWith("student", "note-1", 2); await app.close();
  });
  it.each([{ ...input, content: "x".repeat(20001) }, { ...input, user_id: "another" }, { ...input, title: " " }, { ...input, bookmarked: true }, { ...input, version: -1 }])("rejects invalid writes", async (payload) => {
    const { app, store } = fixture();
    expect((await app.inject({ method: "PUT", url: "/api/v1/student/notebook/note-1", headers: { cookie: "xuetu_session=student" }, payload })).statusCode).toBe(400);
    expect(store.save).not.toHaveBeenCalled(); await app.close();
  });
  it("returns a version conflict instead of claiming a save", async () => {
    const { app, store } = fixture(); vi.mocked(store.save).mockRejectedValue(new NotebookError("NOTEBOOK_CONFLICT", "重新读取", 409));
    const r = await app.inject({ method: "PUT", url: "/api/v1/student/notebook/note-1", headers: { cookie: "xuetu_session=student" }, payload: input });
    expect(r.statusCode).toBe(409); expect(r.json().error.code).toBe("NOTEBOOK_CONFLICT"); await app.close();
  });
});
