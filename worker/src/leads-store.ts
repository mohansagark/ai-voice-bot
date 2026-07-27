export interface LeadRow {
  email: string;
  name: string | null;
  question: string;
  sessionId: string | null;
  userAgent: string | null;
  referer: string | null;
  source: "agent" | "direct";
}

export interface LeadEmailBinding {
  send(msg: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<{ success: boolean }>;
}

export interface LeadsEnv {
  DB?: D1Database;
  LEAD_NOTIFY_FROM?: string;
  LEAD_NOTIFY_TO?: string;
  LEAD_EMAIL?: LeadEmailBinding;
}

export class LeadStoreError extends Error {
  constructor(missing: string) {
    super(`Lead store environment binding missing: ${missing}`);
    this.name = "LeadStoreError";
  }
}

export async function saveLead(env: LeadsEnv, row: LeadRow): Promise<void> {
  if (!env?.DB) throw new LeadStoreError("DB");
  await env.DB
    .prepare(
      "INSERT INTO leads (email, name, question, session_id, source, user_agent, referer) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      row.email,
      row.name,
      row.question,
      row.sessionId,
      row.source,
      row.userAgent,
      row.referer,
    )
    .run();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function buildEmailBody(row: LeadRow): { subject: string; text: string; html: string } {
  const subject = row.name
    ? `New portfolio lead: ${row.name} (${row.email})`
    : `New portfolio lead: ${row.email}`;
  const nameLine = row.name || "(none)";
  const text =
    `Name: ${nameLine}\n` +
    `Email: ${row.email}\n` +
    `Source: ${row.source}\n` +
    `Session: ${row.sessionId || "(none)"}\n` +
    `Question:\n${row.question}`;
  const html =
    `<p><b>Name:</b> ${escapeHtml(nameLine)}<br/>` +
    `<b>Email:</b> ${escapeHtml(row.email)}<br/>` +
    `<b>Source:</b> ${escapeHtml(row.source)}<br/>` +
    `<b>Session:</b> ${escapeHtml(row.sessionId || "(none)")}</p>` +
    `<p><b>Question:</b></p>` +
    `<p>${escapeHtml(row.question).replace(/\n/g, "<br/>")}</p>`;
  return { subject, text, html };
}

export async function notifyLeadByEmail(env: LeadsEnv, row: LeadRow): Promise<void> {
  if (!env.LEAD_NOTIFY_FROM || !env.LEAD_NOTIFY_TO) return;
  if (!env.LEAD_EMAIL) return;
  const { subject, text, html } = buildEmailBody(row);
  try {
    await env.LEAD_EMAIL.send({
      from: env.LEAD_NOTIFY_FROM,
      to: env.LEAD_NOTIFY_TO,
      subject,
      text,
      html,
    });
  } catch (e) {
    console.error("notifyLeadByEmail failed (D1 row already saved):", String((e as Error).message));
  }
}
