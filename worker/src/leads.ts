export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export interface LeadPayload {
  name: string;
  email: string;
  message: string;
  phone: string | null;
  company: string | null;
  consent: unknown;
  meta: unknown;
}

export async function postLead(
  webhookUrl: string,
  payload: LeadPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
