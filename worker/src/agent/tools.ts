import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const saveLeadSchema = z.object({
  name: z.string().describe("The visitor's name"),
  email: z.string().describe("The visitor's email address"),
  message: z.string().describe("What the visitor wants / their message to the owner"),
  phone: z.string().optional(),
  company: z.string().optional(),
});
export type SaveLeadArgs = z.infer<typeof saveLeadSchema>;

// Schema carrier for the model. Actual side effects happen in the save_lead node.
export const saveLeadTool = tool(async (args: SaveLeadArgs) => JSON.stringify(args), {
  name: "save_lead",
  description:
    "Record the visitor's lead. Call this ONLY when you have all of: name, email, and their message. Do not guess missing fields.",
  schema: saveLeadSchema,
});
