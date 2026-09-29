import { describe, expect, it } from "vitest";

import {
  passwordStrengthError,
  ScryptPasswordHasher,
} from "../src/services/auth/password-hasher.js";

describe("scrypt password hashing", () => {
  it("stores a salted KDF record and verifies without exposing the password", async () => {
    const hasher = new ScryptPasswordHasher();
    const encoded = await hasher.hash("StrongPassword123");

    expect(encoded).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u);
    expect(encoded).not.toContain("StrongPassword123");
    expect(await hasher.verify("StrongPassword123", encoded)).toBe(true);
    expect(await hasher.verify("WrongPassword123", encoded)).toBe(false);
    expect(await hasher.hash("StrongPassword123")).not.toBe(encoded);
  });

  it("accepts simple six-character passwords without composition requirements", () => {
    expect(passwordStrengthError("123456")).toBeNull();
    expect(passwordStrengthError("abcdef")).toBeNull();
    expect(passwordStrengthError("12345")).toContain("6");
    expect(passwordStrengthError("123 45")).toBe("密码不能包含空白字符。");
  });
});
