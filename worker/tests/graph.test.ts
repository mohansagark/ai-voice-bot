import { describe, it, expect } from "vitest";
import { saveLeadSchema, saveLeadTool } from "../src/agent/tools";

describe("save_lead tool", () => {
  it("is named save_lead", () => expect(saveLeadTool.name).toBe("save_lead"));
  it("parses a complete lead", () => {
    const r = saveLeadSchema.safeParse({ name: "Jane", email: "jane@x.com", message: "hi" });
    expect(r.success).toBe(true);
  });
  it("rejects when required fields are missing", () => {
    const r = saveLeadSchema.safeParse({ name: "Jane" });
    expect(r.success).toBe(false);
  });
});
