import { describe, it, expect } from "vitest";
import { createApp } from "../src/index";
import type { Env } from "../src/config";

const env: Env = { GROQ_API_KEY: "x", WEBHOOK_URL: "https://hook.test/x", ALLOWED_ORIGINS: "https://devmohan.in" };

describe("/health", () => {
  it("reports ok with the active provider", async () => {
    const app = createApp();
    const res = await app.fetch(new Request("https://w/health"), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("groq");
    expect(body.model).toBe("llama-3.3-70b-versatile");
  });
});
