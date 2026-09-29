import { ChevronLeft, ChevronRight, Search, UserMinus } from "lucide-react";
import { useMemo, useState } from "react";
import type { TeacherClassManagement } from "@xuetu/contracts";

const PAGE_SIZE = 15;

export function TeacherClassMembers({ members, busyKey, onRemove }: {
  members: TeacherClassManagement["members"];
  busyKey: string | null;
  onRemove: (classId: string, studentCode: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("all");
  const [page, setPage] = useState(0);
  const classes = useMemo(() => [...new Map(members.map(member => [member.class_id, member.class_name])).entries()], [members]);
  const activeClassId = classes.some(([id]) => id === classId) ? classId : "all";
  const matching = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return members.filter(member => (activeClassId === "all" || member.class_id === activeClassId)
      && (!term || `${member.display_name} ${member.student_number}`.toLocaleLowerCase().includes(term)));
  }, [members, activeClassId, query]);
  const totalPages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visible = matching.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <div className="teacher-members-browser">
      <div className="teacher-members-filters">
        <label className="teacher-member-search">
          <Search aria-hidden="true" size={17} />
          <input aria-label="搜索班级成员" type="search" placeholder="搜索姓名或学号" value={query}
            onChange={event => { setQuery(event.target.value); setPage(0); }} />
        </label>
        <select aria-label="筛选班级成员" value={activeClassId}
          onChange={event => { setClassId(event.target.value); setPage(0); }}>
          <option value="all">全部班级</option>
          {classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <span aria-live="polite">{matching.length} 名成员</span>
      </div>
      <div className="governance-table-wrap teacher-class-management-table-wrap">
        <table className="teacher-class-member-table">
          <caption className="visually-hidden">教师负责班级的成员</caption>
          <thead><tr><th scope="col">学生</th><th scope="col">学号</th><th scope="col">所在班级</th><th scope="col">操作</th></tr></thead>
          <tbody>
            {visible.map(member => (
              <tr key={`${member.class_id}:${member.student_code}`}>
                <td><strong>{member.display_name}</strong></td>
                <td className="teacher-member-number">{member.student_number}</td>
                <td>{member.class_name}</td>
                <td><button aria-label={`移出班级：${member.display_name}`} className="teacher-class-action danger"
                  disabled={busyKey === `remove:${member.class_id}:${member.student_code}`}
                  onClick={() => onRemove(member.class_id, member.student_code)} type="button">
                  <UserMinus aria-hidden="true" size={15} /> 移出
                </button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!matching.length ? <p className="teacher-class-management-empty">没有匹配的成员，换个姓名、学号或班级试试。</p> : null}
      <nav className="teacher-roster-pagination" aria-label="班级成员分页">
        <span>第 {currentPage + 1} / {totalPages} 页</span>
        <div>
          <button aria-label="上一页成员" type="button" disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}><ChevronLeft aria-hidden="true" size={17} /></button>
          <button aria-label="下一页成员" type="button" disabled={currentPage >= totalPages - 1}
            onClick={() => setPage(currentPage + 1)}><ChevronRight aria-hidden="true" size={17} /></button>
        </div>
      </nav>
    </div>
  );
}
