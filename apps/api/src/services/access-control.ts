import type { PlatformRole } from "@xuetu/contracts";

export const roleCapabilities = {
  student: [
    "profile:read:self",
    "practice:attempt:self",
    "learning_evidence:read:self",
  ],
  teacher: [
    "course:read:assigned",
    "material:manage:assigned",
    "question:manage:assigned",
    "learning_summary:read:assigned",
    "learning_intervention:write:assigned",
    "class:manage:assigned",
  ],
  admin: [
    "identity:manage:any",
    "course:manage:any",
    "material:manage:any",
    "question:manage:any",
    "learning_summary:read:any",
    "learning_intervention:write:any",
    "class:manage:any",
  ],
} as const satisfies Record<PlatformRole, readonly string[]>;

export type PlatformCapabilityRequest =
  | "profile:read"
  | "practice:attempt"
  | "learning_evidence:read"
  | "course:read"
  | "course:manage"
  | "material:manage"
  | "question:manage"
  | "learning_summary:read"
  | "learning_intervention:write"
  | "class:manage"
  | "identity:manage";

export function hasPlatformCapability(
  roles: readonly PlatformRole[],
  capability: PlatformCapabilityRequest,
  context: { courseAssigned: boolean; self?: boolean },
): boolean {
  for (const role of roles) {
    const granted = roleCapabilities[role] as readonly string[];
    if (granted.includes(`${capability}:any`)) return true;
    if (context.courseAssigned && granted.includes(`${capability}:assigned`)) return true;
    if (context.self && granted.includes(`${capability}:self`)) return true;
  }
  return false;
}
