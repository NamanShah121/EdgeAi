# Smart Warehouse — Edge-AI AMR Fleet Coordination

A browser-only React/Vite prototype for SIH 2026. It simulates decentralized AMR task allocation, direct open-floor navigation, proximity-based collision prevention, visible side-step rerouting, charging, warehouse operations, and live telemetry.

## Run locally

```bash
npm install
npm run dev
```

If PowerShell blocks `npm.ps1`, use `npm.cmd run dev`.

## Publish

1. Push this directory to a GitHub repository, excluding `node_modules` and `dist` (already covered by `.gitignore`).
2. Import that repository in Vercel or Netlify.
3. Use `npm run build` as the build command and `dist` as the publish directory.

The application has no backend, environment variables, or external runtime services.
