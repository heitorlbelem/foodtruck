// Postgres reports constraint failures through SQLSTATE codes on the error.
// https://www.postgresql.org/docs/current/errcodes-appendix.html
function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, "23505");
}
