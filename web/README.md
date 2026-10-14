# amiri-web

The Amiri Agent web app (React + TypeScript + Vite): Overview, Alerts, Events, Radar, Monitors,
Market series, Institution (with the setup agent's chat) and the Scenario Studio. A prototype that runs
against a demo bank with sample data.

```bash
npm install
npm run dev        # http://localhost:5173, forwards /api to the server on :8000
npm run build      # dist/, which amiri-server serves at / (WEB_DIST)
npm run typecheck
```

Start the server first (`../server`: `uv run amiri serve`). Roles are applied here, not in the API: use
**View as** in the top bar. Times are shown in the institution's time zone (`src/format.ts`).

Design: tokens and components are in `src/styles/app.css` and `src/styles/extra.css`; both light and
dark themes, and the pages are checked with axe-core for WCAG 2.2 AA.
