import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const saveLeadSchema = z.object({
  name: z.string().describe("The visitor's name"),
  email: z.string().describe("The visitor's email address"),
  message: z.string().describe("What the visitor wants / their message to the owner"),
  phone: z.string().optional(),
  company: z.string().optional(),
  preferredTime: z.string().optional().describe(
    "The visitor's stated preferred date/time to connect, if given (e.g. from a '[Preferred time: ...]' marker in their message). Pass it through as-is — never confirm or schedule it.",
  ),
});
export type SaveLeadArgs = z.infer<typeof saveLeadSchema>;

// Schema carrier for the model. Actual side effects happen in the save_lead node.
export const saveLeadTool = tool(async (args: SaveLeadArgs) => JSON.stringify(args), {
  name: "save_lead",
  description:
    "Record the visitor's lead. Call this ONLY when you have all of: name, email, and their message. Do not guess missing fields.",
  schema: saveLeadSchema,
});

// No side effects here either — the show_time_picker node sets the UI signal the SSE
// stream forwards to the widget, which renders the picker inline in the chat.
export const showTimePickerTool = tool(async () => "Time picker shown to visitor.", {
  name: "show_time_picker",
  description:
    "Show an inline date/time picker in the chat UI for the visitor to specify their preferred time to connect. Call this INSTEAD of asking 'what time works for you?' in plain text, once the visitor has expressed interest in scheduling/connecting and you don't yet have a stated time preference from them. Don't call it if they've already given one.",
  schema: z.object({}),
});
