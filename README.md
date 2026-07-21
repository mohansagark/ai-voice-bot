# AI Voice Bot

Agentic voice greeter for a portfolio site — LangGraph.js in a Cloudflare Worker.
See `docs/superpowers/specs/` for the full design.

## Worker (v0.1) — local dev

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars   # add your free GROQ_API_KEY and a WEBHOOK_URL
npm test                          # unit + integration tests (offline, fake model)
npm run dev                       # wrangler dev on http://localhost:8787
```

Then open `widget/demo.html` in a browser and chat. Get a free Groq key at
console.groq.com; a free webhook at formspree.io.

Set `ALLOWED_ORIGINS` (CSV) in `wrangler.toml` for production; for local demo via
`file://` leave it empty (all origins allowed).
