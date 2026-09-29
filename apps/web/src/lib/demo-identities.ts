export const DEMO_IDENTITIES = {
  student: {
    role: "student",
    userId: "user_student_001",
    label: "学生身份",
  },
  admin: {
    role: "admin",
    userId: "user_admin_001",
    label: "管理员身份",
  },
} as const;

export type DemoRole = keyof typeof DEMO_IDENTITIES;
