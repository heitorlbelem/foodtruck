import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.ts";

describe("behind a proxy", () => {
  const app = buildApp();
  app.get("/__ip", async (request) => ({
    ip: request.ip,
    protocol: request.protocol,
  }));

  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("reads the client ip and the protocol from the proxy headers", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/__ip",
      headers: {
        "x-forwarded-for": "203.0.113.7",
        "x-forwarded-proto": "https",
      },
    });

    expect(response.json()).toEqual({ ip: "203.0.113.7", protocol: "https" });
  });
});
