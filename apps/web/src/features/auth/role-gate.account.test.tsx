import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("./auth-context", () => ({
  useAuth: () => ({
    isProviderMounted: true,
    status: "authenticated",
    account: {
      user_id: "student_temp",
      roles: ["student"],
      must_change_password: true,
    },
  }),
}));

import { RoleGate } from "./role-gate";

describe("RoleGate temporary-password boundary", () => {
  it("redirects a signed-in temporary-password account before rendering student content", () => {
    render(
      <MemoryRouter initialEntries={["/student/practice"]}>
        <Routes>
          <Route path="/account/password" element={<p>required password change</p>} />
          <Route
            path="/student/practice"
            element={<RoleGate role="student"><p>student workspace</p></RoleGate>}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("required password change")).toBeInTheDocument();
    expect(screen.queryByText("student workspace")).not.toBeInTheDocument();
  });
});
