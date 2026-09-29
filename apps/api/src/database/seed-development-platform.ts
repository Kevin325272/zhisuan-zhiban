import type { PlatformRole } from "@xuetu/contracts";

import { roleCapabilities } from "../services/access-control.js";
import { withTransaction, type SqlPool } from "./client.js";

const roleLabels: Record<PlatformRole, { label: string; description: string }> = {
  student: { label: "学生", description: "完成课程学习、作答并查看个人学习证据。" },
  teacher: { label: "教师", description: "维护已分配课程、资料和题目并查看课程学情。" },
  admin: { label: "管理员", description: "管理平台身份、全局课程与数据治理。" },
};

export async function seedDevelopmentPlatform(
  pool: SqlPool,
  now: () => Date = () => new Date(),
): Promise<{
  users: number;
  roles: number;
  courses: number;
  memberships: number;
  catalogEntries: number;
}> {
  const timestamp = now().toISOString();
  return withTransaction(pool, async (client) => {
    for (const role of ["student", "teacher", "admin"] as const) {
      const metadata = roleLabels[role];
      await client.query(
        `INSERT INTO roles(role_key, label, description)
         VALUES ($1,$2,$3)
         ON CONFLICT (role_key) DO UPDATE
         SET label = EXCLUDED.label, description = EXCLUDED.description`,
        [role, metadata.label, metadata.description],
      );
    }

    const permissions = [
      ...new Set(Object.values(roleCapabilities).flatMap((items) => [...items])),
    ];
    for (const permission of permissions) {
      await client.query(
        `INSERT INTO permissions(permission_key, description)
         VALUES ($1,$2)
         ON CONFLICT (permission_key) DO UPDATE
         SET description = EXCLUDED.description`,
        [permission, permission],
      );
    }
    for (const role of ["student", "teacher", "admin"] as const) {
      for (const permission of roleCapabilities[role]) {
        await client.query(
          `INSERT INTO role_permissions(role_key, permission_key)
           VALUES ($1,$2)
           ON CONFLICT DO NOTHING`,
          [role, permission],
        );
      }
    }

    const users = [
      ["user_admin_001", "本地演示管理员", "admin"],
      ["user_teacher_001", "本地演示教师", "teacher"],
      ["user_student_001", "本地演示学生", "student"],
    ] as const;
    for (const [userId, displayName] of users) {
      await client.query(
        `INSERT INTO users(
           user_id, username, display_name, account_status, auth_source, created_at, updated_at
         ) VALUES ($1,$1,$2,'active','local_development',$3,$3)
         ON CONFLICT (user_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             updated_at = EXCLUDED.updated_at`,
        [userId, displayName, timestamp],
      );
    }
    for (const [userId, , role] of users) {
      await client.query(
        `INSERT INTO user_roles(user_id, role_key, granted_by, granted_at)
         VALUES ($1,$2,'user_admin_001',$3)
         ON CONFLICT (user_id, role_key) DO NOTHING`,
        [userId, role, timestamp],
      );
    }

    const courses = [
      ["course_408_001", "CS408", "计算机学科专业基础"],
      ["course_408_ds", "CS408-DS", "数据结构"],
      ["course_408_co", "CS408-CO", "计算机组成原理"],
      ["course_408_os", "CS408-OS", "操作系统"],
      ["course_408_cn", "CS408-CN", "计算机网络"],
    ] as const;
    for (const [courseId, courseCode, title] of courses) {
      await client.query(
        `INSERT INTO courses(
           course_id, course_code, title, discipline, status,
           created_by, created_at, updated_at
         ) VALUES ($1,$2,$3,'计算机科学与技术','active','user_admin_001',$4,$4)
         ON CONFLICT (course_id) DO UPDATE
         SET course_code = EXCLUDED.course_code,
             title = EXCLUDED.title,
             discipline = EXCLUDED.discipline,
             status = EXCLUDED.status,
             updated_at = EXCLUDED.updated_at`,
        [courseId, courseCode, title, timestamp],
      );
      for (const [userId, membershipRole] of [
        ["user_teacher_001", "teacher"],
        ["user_student_001", "student"],
      ] as const) {
        await client.query(
          `INSERT INTO course_memberships(
             course_id, user_id, membership_role, status, created_at
           ) VALUES ($1,$2,$3,'active',$4)
           ON CONFLICT (course_id, user_id) DO UPDATE
           SET membership_role = EXCLUDED.membership_role,
               status = EXCLUDED.status`,
          [courseId, userId, membershipRole, timestamp],
        );
      }
    }

    const catalog = [
      ["course_408_ds", "data-structures", "数据结构", "结构理解、算法实现与复杂度分析。", 1],
      ["course_408_co", "computer-organization", "组成原理", "理解数据表示、存储层次、指令系统与处理器控制。", 2],
      ["course_408_os", "operating-systems", "操作系统", "理解进程、内存、文件与并发机制。", 3],
      ["course_408_cn", "computer-networks", "计算机网络", "理解协议分层、报文传输、路由与端到端通信。", 4],
    ] as const;
    for (const [courseId, slug, subject, summary, displayOrder] of catalog) {
      await client.query(
        `INSERT INTO course_catalog_entries(
           course_id, slug, question_subject, summary, display_order,
           material_status, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,'pending',$6,$6)
         ON CONFLICT (course_id) DO UPDATE
         SET slug = EXCLUDED.slug,
             question_subject = EXCLUDED.question_subject,
             summary = EXCLUDED.summary,
             display_order = EXCLUDED.display_order,
             updated_at = EXCLUDED.updated_at`,
        [courseId, slug, subject, summary, displayOrder, timestamp],
      );
    }

    return {
      users: 3,
      roles: 3,
      courses: courses.length,
      memberships: courses.length * 2,
      catalogEntries: catalog.length,
    };
  });
}
