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
    attempt(email: string, ip: string): LoginCheck {
      const emailKey = normalizeEmail(email);
      const blocked = [
        { entry: live(emails, emailKey), max: maxPerEmail },
        { entry: live(ips, ip), max: maxPerIp },
      ].filter(({ entry, max }) => entry && entry.failures >= max);

      if (blocked.length > 0) {
        const resetAt = Math.max(...blocked.map(({ entry }) => entry!.resetAt));

        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((resetAt - Date.now()) / 1000),
          ),
        };
      }

      record(emails, emailKey);
      record(ips, ip);

      return { allowed: true };
    },

    succeed(email: string, ip: string): void {
      emails.delete(normalizeEmail(email));

      const entry = live(ips, ip);
      if (entry && --entry.failures <= 0) {
        ips.delete(ip);
      }
    },

    clear(): void {
      emails.clear();
      ips.clear();
    },
  };
}

export type LoginLimiter = ReturnType<typeof makeLoginLimiter>;
