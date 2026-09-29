import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { createDemoSession } from "./demo-session";
import { RoleGate } from "./role-gate";

function CurrentLocation() {
  const location = useLocation();
  return <p>location:{location.pathname}</p>;
}

function renderStudentRoute() {
  return render(
    <MemoryRouter initialEntries={["/student/practice"]}>
      <Routes>
        <Route path="/login" element={<CurrentLocation />} />
        <Route path="/admin" element={<CurrentLocation />} />
        <Route
          path="/student/practice"
          element={
            <RoleGate role="student">
              <p>student workspace</p>
            </RoleGate>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RoleGate", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("redirects an unauthenticated visit to the login entry", () => {
    renderStudentRoute();
    expect(screen.getByText("location:/login")).toBeInTheDocument();
  });

  it("redirects a mismatched role to its own workspace", () => {
    createDemoSession("admin");
    renderStudentRoute();
    expect(screen.getByText("location:/admin")).toBeInTheDocument();
  });

  it("renders the protected workspace for the matching role", () => {
    createDemoSession("student");
    renderStudentRoute();
    expect(screen.getByText("student workspace")).toBeInTheDocument();
  });
});

