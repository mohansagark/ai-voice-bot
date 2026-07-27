import { describe, it, expect, vi } from "vitest";
import { saveLead, notifyLeadByEmail, type LeadRow, type LeadsEnv } from "../src/leads-store";

function fakeD1(rows: Array<Record<string, unknown>> = []): {
  DB: any;
  calls: Array<{ sql: string; binds: unknown[] }>;
} {
  const calls: Array<{ sql: string; binds: unknown[] }> = [];
  const DB = {
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => ({
        run: async () => {
          calls.push({ sql, binds });
          rows.push({ id: rows.length + 1, ...(binds as any)[0] });
          return { success: true };
        },
      }),
    }),
  };
  return { DB, calls };
}

const baseRow: LeadRow = {
  email: "jane@example.com",
  name: "Jane",
  question: "Is Mohan open to a senior AI role?",
  sessionId: "sess-1",
  userAgent: "Mozilla/5.0",
  referer: "https://devmohan.in/",
  source: "agent",
};

describe("saveLead", () => {
  it("inserts a row with source='agent' by default", async () => {
    const { DB, calls } = fakeD1();
    const env: LeadsEnv = { DB };
    await saveLead(env, baseRow);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/INSERT INTO leads/i);
    expect(calls[0].binds).toEqual([
      "jane@example.com",
      "Jane",
      "Is Mohan open to a senior AI role?",
      "sess-1",
      "agent",
      "Mozilla/5.0",
      "https://devmohan.in/",
    ]);
  });

  it("uses source='direct' when set", async () => {
    const { DB, calls } = fakeD1();
    await saveLead({ DB }, { ...baseRow, source: "direct" });
    expect((calls[0].binds as string[])[4]).toBe("direct");
  });

  it("throws when env.DB is missing", async () => {
    await expect(saveLead({} as LeadsEnv, baseRow)).rejects.toThrow(/DB/);
  });

  it("bubbles D1 errors", async () => {
    const DB = {
      prepare: () => ({
        bind: () => ({
          run: async () => {
            throw new Error("d1 down");
          },
        }),
      }),
    };
    await expect(saveLead({ DB: DB as any }, baseRow)).rejects.toThrow("d1 down");
  });
});

describe("notifyLeadByEmail", () => {
  it("is a no-op when LEAD_NOTIFY_FROM is missing", async () => {
    const fetchImpl = vi.fn();
    await notifyLeadByEmail(
      { RESEND_API_KEY: "re_x", LEAD_NOTIFY_TO: "m@x.com" },
      baseRow,
      fetchImpl,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is a no-op when LEAD_NOTIFY_TO is missing", async () => {
    const fetchImpl = vi.fn();
    await notifyLeadByEmail(
      { RESEND_API_KEY: "re_x", LEAD_NOTIFY_FROM: "Leo <l@x.com>" },
      baseRow,
      fetchImpl,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is a no-op when RESEND_API_KEY is missing", async () => {
    const fetchImpl = vi.fn();
    await notifyLeadByEmail(
      { LEAD_NOTIFY_FROM: "Leo <l@x.com>", LEAD_NOTIFY_TO: "m@x.com" },
      baseRow,
      fetchImpl,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls Resend's REST API with the expected shape when fully configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    await notifyLeadByEmail(
      {
        RESEND_API_KEY: "re_x",
        LEAD_NOTIFY_FROM: "Leo <leo@devmohan.in>",
        LEAD_NOTIFY_TO: "mohan@devmohan.in",
      },
      baseRow,
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_x");
    const arg = JSON.parse(init.body as string);
    expect(arg.from).toBe("Leo <leo@devmohan.in>");
    expect(arg.to).toBe("mohan@devmohan.in");
    expect(arg.subject).toContain("jane@example.com");
    expect(arg.text).toContain("Jane");
    expect(arg.text).toContain("jane@example.com");
    expect(arg.text).toContain("Is Mohan open to a senior AI role?");
    expect(arg.html).toContain("Jane");
  });

  it("swallows Resend failures, network or non-OK (D1 is the source of truth)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      notifyLeadByEmail(
        { RESEND_API_KEY: "re_x", LEAD_NOTIFY_FROM: "Leo <l@x.com>", LEAD_NOTIFY_TO: "m@x.com" },
        baseRow,
        fetchImpl as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("logs but does not throw when Resend responds non-OK", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad request", { status: 422 }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      notifyLeadByEmail(
        { RESEND_API_KEY: "re_x", LEAD_NOTIFY_FROM: "Leo <l@x.com>", LEAD_NOTIFY_TO: "m@x.com" },
        baseRow,
        fetchImpl as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("escapes HTML special characters in the question", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    await notifyLeadByEmail(
      { RESEND_API_KEY: "re_x", LEAD_NOTIFY_FROM: "l@x.com", LEAD_NOTIFY_TO: "m@x.com" },
      { ...baseRow, name: "<script>", question: "is 5 < 10 & ok?" },
      fetchImpl as unknown as typeof fetch,
    );
    const arg = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(arg.html).toContain("&lt;script&gt;");
    expect(arg.html).toContain("5 &lt; 10 &amp; ok?");
  });
});
