import { normalizeEmail } from "../users/passwords.ts";

type Entry = { failures: number; resetAt: number };

export type LoginCheck =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

export function makeLoginLimiter({
  maxPerEmail = 5,
  maxPerIp = 20,
  windowMs = 15 * 60_000,
}: { maxPerEmail?: number; maxPerIp?: number; windowMs?: number } = {}) {
  const emails = new Map<string, Entry>();
  const ips = new Map<string, Entry>();

  function live(map: Map<string, Entry>, key: string): Entry | undefined {
    const entry = map.get(key);

    if (entry && entry.resetAt <= Date.now()) {
      map.delete(key);
      return undefined;
    }

    return entry;
  }

  function record(map: Map<string, Entry>, key: string) {
    const entry = live(map, key);

    if (entry) {
      entry.failures += 1;
    } else {
      map.set(key, { failures: 1, resetAt: Date.now() + windowMs });
    }
  }

  return {
    check(email: string, ip: string): LoginCheck {
      const blocked = [
        { entry: live(emails, normalizeEmail(email)), max: maxPerEmail },
        { entry: live(ips, ip), max: maxPerIp },
      ].filter(({ entry, max }) => entry && entry.failures >= max);

      if (blocked.length === 0) {
        return { allowed: true };
      }

      const resetAt = Math.max(...blocked.map(({ entry }) => entry!.resetAt));

      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((resetAt - Date.now()) / 1000),
        ),
      };
    },

    fail(email: string, ip: string): void {
      record(emails, normalizeEmail(email));
      record(ips, ip);
    },

    succeed(email: string): void {
      emails.delete(normalizeEmail(email));
    },

    clear(): void {
      emails.clear();
      ips.clear();
    },
  };
}

export type LoginLimiter = ReturnType<typeof makeLoginLimiter>;
