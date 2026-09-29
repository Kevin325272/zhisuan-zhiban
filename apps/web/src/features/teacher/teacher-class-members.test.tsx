import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TeacherClassManagement } from "@xuetu/contracts";
import { TeacherClassMembers } from "./teacher-class-members";

const members: TeacherClassManagement["members"] = Array.from({ length: 32 }, (_, index) => ({
  class_id: index % 2 ? "class-b" : "class-a",
  class_name: index % 2 ? "软件工程2班" : "软件工程1班",
  student_code: `student-${index}`,
  display_name: `学生${index + 1}`,
  student_number: String(20240001 + index),
  joined_at: "2026-08-25T08:00:00.000Z",
}));

describe("TeacherClassMembers", () => {
  it("paginates a large roster and searches the complete set rather than the current page", () => {
    render(<TeacherClassMembers members={members} busyKey={null} onRemove={vi.fn()} />);
    const table = screen.getByRole("table", { name: "教师负责班级的成员" });
    expect(within(table).getAllByRole("columnheader").map(header => header.textContent)).toEqual(["学生", "学号", "所在班级", "操作"]);
    expect(within(within(table).getByRole("row", { name: /^学生1\s/ })).getAllByRole("cell").slice(0, 3).map(cell => cell.textContent))
      .toEqual(["学生1", "20240001", "软件工程1班"]);
    expect(within(table).getAllByRole("row")).toHaveLength(16);
    expect(within(table).queryByText("学生32")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页成员" }));
    expect(within(table).getByText("学生16")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索班级成员" }), { target: { value: "20240032" } });
    expect(within(table).getByText("学生32")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });

  it("filters members by class and passes both class and student identity to removal", () => {
    const remove = vi.fn();
    render(<TeacherClassMembers members={members} busyKey={null} onRemove={remove} />);
    fireEvent.change(screen.getByRole("combobox", { name: "筛选班级成员" }), { target: { value: "class-b" } });
    const table = screen.getByRole("table", { name: "教师负责班级的成员" });
    expect(within(table).queryByText("学生1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移出班级：学生2" }));
    expect(remove).toHaveBeenCalledWith("class-b", "student-1");
  });

  it("keeps the last page usable when its only remaining member is removed", () => {
    const remove = vi.fn();
    const { rerender } = render(<TeacherClassMembers members={members.slice(0, 16)} busyKey={null} onRemove={remove} />);
    fireEvent.click(screen.getByRole("button", { name: "下一页成员" }));
    rerender(<TeacherClassMembers members={members.slice(0, 15)} busyKey={null} onRemove={remove} />);
    expect(screen.getByText("学生1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一页成员" })).toBeDisabled();
  });

  it("returns to all classes if the selected class no longer has any members", () => {
    const remove = vi.fn();
    const { rerender } = render(<TeacherClassMembers members={members.slice(0, 2)} busyKey={null} onRemove={remove} />);
    fireEvent.change(screen.getByRole("combobox", { name: "筛选班级成员" }), { target: { value: "class-b" } });
    rerender(<TeacherClassMembers members={members.slice(0, 1)} busyKey={null} onRemove={remove} />);
    expect(screen.getByRole("combobox", { name: "筛选班级成员" })).toHaveValue("all");
    expect(screen.getByText("学生1")).toBeInTheDocument();
  });
});
