export interface ChatEvents {
  onToken(text: string): void;
  onLead(lead: unknown): void;
  onDone(reply: string, leadSaved: boolean): void;
  onError(message: string): void;
  onBlocked(): void;
  onLimitReached(): void;
  onComponent(type: string): void;
}

export function parseSSE(buffer: string): { frames: { event: string; data: string }[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const frames: { event: string; data: string }[] = [];
  for (const part of parts) {
    const event = /event: (.*)/.exec(part)?.[1];
    const data = /data: (.*)/.exec(part)?.[1];
    if (event && data !== undefined) frames.push({ event, data });
  }
  return { frames, rest };
}

export async function sendChat(
  workerUrl: string,
  body: { session_id: string; message: string; consent: unknown },
  events: ChatEvents,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(`${workerUrl}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    events.onError(String((e as Error).message));
    return;
  }

  if (res.status === 429) {
    const info = (await res.json().catch(() => ({}))) as { blocked?: boolean; limitReached?: boolean };
    if (info?.blocked) events.onBlocked();
    else if (info?.limitReached) events.onLimitReached();
    else events.onError("rate limited");
    return;
  }
  if (!res.ok || !res.body) { events.onError(`error ${res.status}`); return; }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const dispatch = (f: { event: string; data: string }) => {
    const payload = JSON.parse(f.data);
    if (f.event === "token") events.onToken(payload.text);
    else if (f.event === "lead") events.onLead(payload.lead);
    else if (f.event === "component") events.onComponent(payload.type);
    else if (f.event === "done") events.onDone(payload.reply, !!payload.lead_saved);
    else if (f.event === "error") events.onError(payload.message);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const { frames, rest } = parseSSE(buf);
      buf = rest;
      for (const f of frames) dispatch(f);
    }
    // Flush a trailing frame that wasn't terminated by a final `\n\n`.
    if (buf.trim()) {
      const { frames } = parseSSE(buf + "\n\n");
      for (const f of frames) dispatch(f);
    }
  } catch (e) {
    events.onError(String((e as Error).message));
  }
}
