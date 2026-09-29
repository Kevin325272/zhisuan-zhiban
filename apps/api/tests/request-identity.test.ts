import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { resolveRequestIdentity } from "../src/services/auth/request-identity.js";
import type { LocalAuthenticationService, PublicAccount } from "../src/services/auth/authentication.js";
import type { CourseContentService } from "../src/services/course-content/course-content.js";
import type { PlatformAccessService } from "../src/services/platform-access.js";

const temporaryAccount: PublicAccount = {
  user_id: "user_temp_001",
  username: "temp_student",
  display_name: "临时账户",
  account_status: "active",
  roles: ["student"],
  auth_source: "local_development",
  account_origin: "registered",
  data_boundary: "local_account",
  must_change_password: true,
  created_at: "2026-08-19T00:00:00.000Z",
  updated_at: "2026-08-19T00:00:00.000Z",
  last_login_at: null,
};

describe("request identity password-change boundary", () => {
  it("does not authorize business APIs with a temporary-password session", async () => {
    const request = { headers: { cookie: "xuetu_session=temp-token" } } as never;
    const authentication = {
      async resolveSession() { return { account: temporaryAccount }; },
    } as unknown as LocalAuthenticationService;

    const identity = await resolveRequestIdentity(request, {
      authentication,
      platformAccess: null,
      allowLocalDevAuth: false,
    });

    expect(identity).toBeNull();
  });

  it("resolves a protected route session only once per request", async () => {
    let resolveCount = 0;
    const account: PublicAccount = {
      ...temporaryAccount,
      must_change_password: false,
    };
    const authentication = {
      async resolveSession() {
        resolveCount += 1;
        return { account };
      },
    } as unknown as LocalAuthenticationService;
    const platformAccess = {
      async getActor() {
        return {
          user: {
            user_id: account.user_id,
            display_name: account.display_name,
            account_status: "active" as const,
            auth_source: "local_development" as const,
            created_at: account.created_at,
            updated_at: account.updated_at,
          },
          roles: ["student" as const],
        };
      },
      async isCourseAssigned() {
        return true;
      },
    } satisfies PlatformAccessService;
    const courseContent = {
      async listCourses() {
        return { courses: [] };
      },
    } as unknown as CourseContentService;
    const app = buildApp({ authentication, platformAccess, courseContent });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/408/courses",
      headers: { cookie: "xuetu_session=valid-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(resolveCount).toBe(1);
    await app.close();
  });
});
