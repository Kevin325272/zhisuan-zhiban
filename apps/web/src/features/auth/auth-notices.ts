export const LOGIN_NOTICE_COPY = {
  password_changed: "密码已更新，出于安全原因请使用新密码重新登录。",
} as const;

export type LoginNoticeCode = keyof typeof LOGIN_NOTICE_COPY;
