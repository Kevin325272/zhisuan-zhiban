import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
type ScryptRunOptions = { N: number; r: number; p: number; maxmem: number };

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptRunOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;
// A non-account Scrypt record used only to equalize unknown-user login work.
// Its plaintext is not a credential and the cost parameters match production defaults.
export const DUMMY_PASSWORD_HASH = "scrypt$16384$8$1$eHVldHUtZHVtbXktc2FsdA$3w81xprGETpY7y0E2EOEpdO67Gc1FDmwKi-rCSTPM2m12aA6c_kcCuRrXonHcWVzj9WWpkr72dF5vOZckGbJgA";

export function passwordStrengthError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `密码至少需要 ${PASSWORD_MIN_LENGTH} 位。`;
  if (password.length > PASSWORD_MAX_LENGTH) return `密码不能超过 ${PASSWORD_MAX_LENGTH} 位。`;
  if (/\s/u.test(password)) return "密码不能包含空白字符。";
  return null;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
}

interface ScryptOptions {
  cost: number;
  blockSize: number;
  parallelization: number;
  keyLength: number;
  saltBytes: number;
}

const DEFAULT_OPTIONS: ScryptOptions = {
  cost: 16_384,
  blockSize: 8,
  parallelization: 1,
  keyLength: 64,
  saltBytes: 16,
};

function encode(value: Buffer) {
  return value.toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url");
}

export class ScryptPasswordHasher implements PasswordHasher {
  private readonly options: ScryptOptions;

  constructor(options: Partial<ScryptOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async hash(password: string) {
    const salt = randomBytes(this.options.saltBytes);
    const derived = (await scrypt(password, salt, this.options.keyLength, {
      N: this.options.cost,
      r: this.options.blockSize,
      p: this.options.parallelization,
      maxmem: 64 * 1024 * 1024,
    })) as Buffer;
    return [
      "scrypt",
      this.options.cost,
      this.options.blockSize,
      this.options.parallelization,
      encode(salt),
      encode(derived),
    ].join("$");
  }

  async verify(password: string, encoded: string) {
    try {
      const [algorithm, rawCost, rawBlockSize, rawParallelization, saltValue, digestValue] = encoded.split("$");
      if (algorithm !== "scrypt" || !rawCost || !rawBlockSize || !rawParallelization || !saltValue || !digestValue) {
        return false;
      }
      const cost = Number(rawCost);
      const blockSize = Number(rawBlockSize);
      const parallelization = Number(rawParallelization);
      const salt = decode(saltValue);
      const expected = decode(digestValue);
      if (!Number.isSafeInteger(cost) || !Number.isSafeInteger(blockSize) || !Number.isSafeInteger(parallelization)) {
        return false;
      }
      const derived = (await scrypt(password, salt, expected.length, {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: 64 * 1024 * 1024,
      })) as Buffer;
      return derived.length === expected.length && timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }
}
