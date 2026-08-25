# Google Classroom integration

Google Integration is available only from `Settings -> Google Integration`. It uses Cloudflare Pages Functions for Google OAuth and API access. Google access and refresh tokens are encrypted into an `HttpOnly`, `SameSite=Lax` cookie and are never exposed to frontend JavaScript or localStorage. The browser stores only normalized Classroom/Gmail update cards for offline display.

## Required Cloudflare secrets

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_SESSION_SECRET` (a random value at least 32 characters long)

## Google Cloud setup

1. Enable Google Classroom API and Gmail API.
2. Configure the OAuth consent screen.
3. Add the production callback URL: `https://YOUR_DOMAIN/api/google/callback`.
4. For local Wrangler testing, also add the exact local callback URL printed by Wrangler, ending in `/api/google/callback`.

Classroom read-only permissions are requested during the initial connection. Gmail metadata permission is requested separately only if the user enables Gmail Notifications.

For local development, copy `.dev.vars.example` to `.dev.vars`, add the real values, then run the project-owned development server:

```powershell
npm run dev
```

Open `http://127.0.0.1:8788/settings.html#google-integration`. If the page is opened through VS Code Live Server on port `5500`, the frontend automatically uses the API server on port `8788`.

`npm run dev:wrangler` remains available for testing the Cloudflare Pages runtime directly on port `8790`.
