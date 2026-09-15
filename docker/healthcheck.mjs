// Docker healthcheck for the dev container (root docker-compose.yml).
// /api/public/* requires a service token (ADR 0012 §4), so a plain HTTP probe
// isn't enough — this sends the same Bearer token the frontend would use.
try {
  const res = await fetch('http://localhost:3001/api/public/health', {
    headers: { Authorization: `Bearer ${process.env.SERVICE_TOKEN_READ ?? ''}` },
  })
  process.exit(res.ok ? 0 : 1)
} catch {
  process.exit(1)
}
