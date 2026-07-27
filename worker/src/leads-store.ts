export interface LeadRow {
  email: string;
  name: string | null;
  question: string;
  sessionId: string | null;
  userAgent: string | null;
  referer: string | null;
  source: "agent" | "direct";
  // The visitor's stated preferred date/time to connect, if given — never a confirmed booking.
  preferredTime?: string | null;
}

export interface LeadsEnv {
  DB?: D1Database;
  LEAD_NOTIFY_FROM?: string;
  LEAD_NOTIFY_TO?: string;
  RESEND_API_KEY?: string;
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
      "INSERT INTO leads (email, name, question, session_id, source, user_agent, referer, preferred_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      row.email,
      row.name,
      row.question,
      row.sessionId,
      row.source,
      row.userAgent,
      row.referer,
      row.preferredTime ?? null,
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
  const preferredTimeLine = row.preferredTime ? `Preferred time: ${row.preferredTime}\n` : "";
  const text =
    `Name: ${nameLine}\n` +
    `Email: ${row.email}\n` +
    `Source: ${row.source}\n` +
    `Session: ${row.sessionId || "(none)"}\n` +
    preferredTimeLine +
    `Question:\n${row.question}`;
  const html =
    `<p><b>Name:</b> ${escapeHtml(nameLine)}<br/>` +
    `<b>Email:</b> ${escapeHtml(row.email)}<br/>` +
    `<b>Source:</b> ${escapeHtml(row.source)}<br/>` +
    `<b>Session:</b> ${escapeHtml(row.sessionId || "(none)")}` +
    (row.preferredTime ? `<br/><b>Preferred time:</b> ${escapeHtml(row.preferredTime)}` : "") +
    `</p>` +
    `<p><b>Question:</b></p>` +
    `<p>${escapeHtml(row.question).replace(/\n/g, "<br/>")}</p>`;
  return { subject, text, html };
}

// Resend, not Cloudflare Email Sending — the latter is gated behind the Workers Paid
// plan. Resend's free tier (3,000/mo, 100/day) needs only an API key, no plan upgrade.
export async function notifyLeadByEmail(env: LeadsEnv, row: LeadRow, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!env.LEAD_NOTIFY_FROM || !env.LEAD_NOTIFY_TO) return;
  if (!env.RESEND_API_KEY) return;
  const { subject, text, html } = buildEmailBody(row);
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: env.LEAD_NOTIFY_FROM, to: env.LEAD_NOTIFY_TO, subject, text, html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`notifyLeadByEmail failed (D1 row already saved): resend error ${res.status}${body ? ` — ${body}` : ""}`);
    }
  } catch (e) {
    console.error("notifyLeadByEmail failed (D1 row already saved):", String((e as Error).message));
  }
}
