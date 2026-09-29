#!/bin/sh

set -eu

source_env=${1:-}
target_dir=${2:-}

if [ -z "$source_env" ] || [ -z "$target_dir" ]; then
  echo "usage: bootstrap-env.sh SOURCE_ENV TARGET_DIR" >&2
  exit 64
fi
if [ ! -f "$source_env" ]; then
  echo "source environment file does not exist" >&2
  exit 66
fi
if [ ! -d "$target_dir" ]; then
  echo "target directory does not exist" >&2
  exit 72
fi

source_path=$(readlink -f "$source_env")
target_path=$(readlink -f "$target_dir")
production_env="$target_path/.env.production"
credential_file="$target_path/.demo-credentials"

if [ "$source_path" = "$production_env" ] || [ "$source_path" = "$credential_file" ]; then
  echo "source and destination files must be different" >&2
  exit 65
fi
if [ -e "$production_env" ] || [ -e "$credential_file" ]; then
  echo "target deployment is already initialized" >&2
  exit 73
fi

public_origin=$(awk -F= '$1 == "XUETU_PUBLIC_ORIGIN" { sub(/^[^=]*=/, ""); print; exit }' "$source_path" | tr -d '\r')
case "$public_origin" in
  https://*) ;;
  *)
    echo "XUETU_PUBLIC_ORIGIN must be an explicit https:// origin" >&2
    exit 78
    ;;
esac
origin_authority=${public_origin#https://}
case "$origin_authority" in
  ""|*/*|*@*|*[[:space:]]*|*\?*|*\#*)
    echo "XUETU_PUBLIC_ORIGIN must contain only an HTTPS host and optional port" >&2
    exit 78
    ;;
esac
tls_server_name=${origin_authority%%:*}
case "$tls_server_name" in
  ""|*/*|*@*|*[[:space:]]*)
    echo "XUETU_PUBLIC_ORIGIN must contain a valid TLS server name" >&2
    exit 78
    ;;
esac
tls_issuer=$(awk -F= '$1 == "XUETU_TLS_ISSUER" { sub(/^[^=]*=/, ""); print; exit }' "$source_path" | tr -d '\r')
case "$tls_issuer" in
  "") tls_issuer=internal ;;
  internal|acme) ;;
  *)
    echo "XUETU_TLS_ISSUER must be internal or acme" >&2
    exit 78
    ;;
esac

umask 077
temporary_env=$(mktemp "$target_path/.env.production.tmp.XXXXXX")
temporary_credentials=$(mktemp "$target_path/.demo-credentials.tmp.XXXXXX")
cleanup() {
  rm -f -- "$temporary_env" "$temporary_credentials"
}
trap cleanup EXIT HUP INT TERM

database_password=$(openssl rand -hex 24)
admin_password="XuetuAdmin!$(openssl rand -hex 8)A7"
demo_password="XuetuDemo!$(openssl rand -hex 8)B8"

{
  printf '%s\n' 'XUETU_HTTP_PORT=80' 'XUETU_HTTPS_PORT=443'
  printf 'XUETU_PUBLIC_ORIGIN=%s\n' "$public_origin"
  printf 'XUETU_TLS_SERVER_NAME=%s\n' "$tls_server_name"
  printf 'XUETU_TLS_ISSUER=%s\n' "$tls_issuer"
  printf '%s\n' 'POSTGRES_DB=xuetu'
  printf '%s\n' 'POSTGRES_USER=xuetu_app'
  printf 'POSTGRES_PASSWORD=%s\n' "$database_password"
  printf '%s\n' 'DATABASE_POOL_MAX=10' 'DATABASE_SSL=disable'
  printf '%s\n' 'NODE_ENV=production' 'XUETU_AUTH_MODE=session'
  printf '%s\n' 'XUETU_AUTH_COOKIE_SECURE=true' 'XUETU_TRUST_PROXY=true'
  printf '%s\n' 'XUETU_LISTEN_HOST=0.0.0.0'
  printf '%s\n' 'XUETU_ENABLE_DEV_IDENTITY_HEADER=false'
  printf '%s\n' 'XUETU_ALLOW_MOCK_SCENARIOS=false'
  printf '%s\n' 'XUETU_ENABLE_LEGACY_AGENT_ROUTES=false'
  printf '%s\n' 'XUETU_ENABLE_LEGACY_DEMO_ROUTES=false'
  printf '%s\n' 'XUETU_ALLOW_LOCAL_DEMO_PAST_EXAMS=true'
  printf '%s\n' 'XUETU_STUDENT_REGISTRATION_MODE=self_service'
  printf '%s\n' 'XUETU_DEMO_COURSE_IDS=course_408_ds,course_408_co,course_408_os,course_408_cn'
  printf 'XUETU_INITIAL_ADMIN_PASSWORD=%s\n' "$admin_password"
  printf 'XUETU_LEGACY_STUDENT_PASSWORD=%s\n' "$demo_password"
  printf '%s\n' 'XUETU_SYNC_DEMO_CREDENTIALS=false'
  printf '%s\n' 'STUDENT_CARE_ENABLED=true'
  printf '%s\n' 'EXTERNAL_QUESTION_STORAGE_DIR=/app/.runtime/external-questions'
  awk -F= '$1 ~ /^(LLM_BASE_URL|LLM_API_KEY|LLM_MODEL|LLM_TIMEOUT_MS|LLM_API_FORMAT|LLM_REASONING_EFFORT|LLM_MAX_OUTPUT_TOKENS|AI_WORKFLOW_PROVIDER|XUETU_ALLOW_UNVERIFIED_AI_SOURCE_EXPORT|EVALUATOR_MODE|EVALUATOR_BASE_URL|EVALUATOR_ALLOW_MOCK_FALLBACK|EVALUATOR_TIMEOUT_MS|EVALUATOR_MAX_POLL_ATTEMPTS|EVALUATOR_MAX_CONCURRENT_RUNS)$/ { print }' "$source_path"
} > "$temporary_env"

{
  printf '%s\n' 'ADMIN_USERNAME=user_admin_001'
  printf '%s\n' 'TEACHER_USERNAME=user_teacher_001'
  printf '%s\n' 'STUDENT_USERNAME=user_student_001'
  printf 'ADMIN_PASSWORD=%s\n' "$admin_password"
  printf 'DEMO_PASSWORD=%s\n' "$demo_password"
} > "$temporary_credentials"

chmod 600 "$temporary_env" "$temporary_credentials"
mv -f -- "$temporary_env" "$production_env"
mv -f -- "$temporary_credentials" "$credential_file"

if command -v shred >/dev/null 2>&1; then
  shred -u -- "$source_path"
else
  rm -f -- "$source_path"
fi

trap - EXIT HUP INT TERM
printf 'environment_file=%s mode=%s\n' "$production_env" "$(stat -c '%a' "$production_env")"
printf 'credential_file=%s mode=%s\n' "$credential_file" "$(stat -c '%a' "$credential_file")"
