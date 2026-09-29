import type {
  ClassEnrollmentCancellation,
  ClassEnrollmentDecisionRequest,
  ClassInvitationRevocation,
  ClassMemberRemoval,
  StudentClassEnrollmentRequest,
  StudentClassEnrollmentRequestCreate,
  StudentClassEnrollmentStatus,
  TeacherClassCreateRequest,
  TeacherClassInvitationCreated,
  TeacherClassManagement,
  TeacherManagedClass,
} from "@xuetu/contracts";

export interface ClassEnrollmentViewer {
  viewerUserId: string;
  viewerRole: "teacher" | "admin";
}

export interface ClassEnrollmentService {
  getStudentStatus(userId: string): Promise<StudentClassEnrollmentStatus>;
  submitStudentRequest(
    userId: string,
    input: StudentClassEnrollmentRequestCreate,
  ): Promise<StudentClassEnrollmentStatus>;
  cancelStudentRequest(userId: string): Promise<ClassEnrollmentCancellation>;
  listTeacherClasses(
    courseId: string,
    viewer: ClassEnrollmentViewer,
  ): Promise<TeacherClassManagement>;
  createClass(
    courseId: string,
    viewer: ClassEnrollmentViewer,
    input: TeacherClassCreateRequest,
  ): Promise<TeacherManagedClass>;
  createInvitation(
    courseId: string,
    classId: string,
    viewer: ClassEnrollmentViewer,
  ): Promise<TeacherClassInvitationCreated>;
  revokeInvitation(
    courseId: string,
    classId: string,
    viewer: ClassEnrollmentViewer,
  ): Promise<ClassInvitationRevocation>;
  decideRequest(
    courseId: string,
    classId: string,
    requestId: string,
    viewer: ClassEnrollmentViewer,
    input: ClassEnrollmentDecisionRequest,
  ): Promise<StudentClassEnrollmentRequest>;
  removeMember(
    courseId: string,
    classId: string,
    studentCode: string,
    viewer: ClassEnrollmentViewer,
  ): Promise<ClassMemberRemoval>;
}

export class ClassEnrollmentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409,
  ) {
    super(message);
    this.name = "ClassEnrollmentError";
  }
}
