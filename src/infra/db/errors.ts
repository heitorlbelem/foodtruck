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

export function isForeignKeyViolation(error: unknown): boolean {
  return hasCode(error, "23503");
}
