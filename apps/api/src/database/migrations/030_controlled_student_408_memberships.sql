WITH eligible_students AS (
  SELECT DISTINCT u.user_id
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
   WHERE u.account_origin = 'registered'
     AND u.account_status = 'active'
     AND ur.role_key = 'student'
     AND EXISTS (
       SELECT 1
         FROM course_memberships existing_membership
        WHERE existing_membership.user_id = u.user_id
          AND existing_membership.membership_role = 'student'
          AND existing_membership.course_id IN (
            'course_408_ds',
            'course_408_co',
            'course_408_os',
            'course_408_cn'
          )
     )
), target_courses AS (
  SELECT course_id
    FROM courses
   WHERE status = 'active'
     AND course_id IN (
       'course_408_ds',
       'course_408_co',
       'course_408_os',
       'course_408_cn'
     )
)
INSERT INTO course_memberships(
  course_id,
  user_id,
  membership_role,
  status,
  created_at
)
SELECT target_courses.course_id,
       eligible_students.user_id,
       'student',
       'active',
       now()
  FROM eligible_students
 CROSS JOIN target_courses
ON CONFLICT (course_id, user_id) DO UPDATE
SET status = 'active'
WHERE course_memberships.membership_role = 'student';
