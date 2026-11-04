export const healthSchema = {
  type: "object",
  properties: {
    updated_at: { type: "string" },
    database: {
      type: "object",
      properties: {
        status: { type: "string" },
        server_version: { type: "string" },
        latency_ms: { type: "number" },
        pool: {
          type: "object",
          properties: {
            total: { type: "number" },
            idle: { type: "number" },
            waiting: { type: "number" },
          },
        },
      },
    },
  },
};

export const liveSchema = {
  type: "object",
  properties: { status: { type: "string" } },
};
