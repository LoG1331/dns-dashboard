# DNS Dashboard — Frontend

Web UI for DNS management (Vite + React + Tailwind), used together with the [backend](../backend).

## Run

```bash
cp .env.example .env   # VITE_API_URL points to the backend
npm install
npm run dev            # http://localhost:5173
```

## Pages

- `/` — landing
- `/login` — admin login
- `/dashboard` — zone management (add/delete, sync from PowerDNS, apply template)
- `/zones/:id` — zone record management
- `/templates` + `/templates/:id` — zone templates
- `/settings` — account + PowerDNS/nameservers/secondary configuration
