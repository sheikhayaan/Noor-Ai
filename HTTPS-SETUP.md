# Phase 5 - Trusted Local HTTPS (mkcert)

Serve the Noor AI frontend (:3000) and FastAPI backend (:8000) over TLS with a
certificate your browser actually trusts - no "your connection is not private"
warning - using [mkcert](https://github.com/FiloSottile/mkcert).

Everything here is **opt-in and additive**. The default `npm run dev` + plain
`uvicorn` HTTP workflow is untouched; nothing below runs unless you invoke it.

Noor Gateway (:8080) is **not** affected: it is a server-to-server dependency
that Noor AI calls over loopback, so it stays on plain HTTP. Start it as usual
with `scripts\start_gateway.ps1` - it must be running either way, or chat fails
with `Cannot reach Noor Gateway`.

## One-time setup (interactive - run these yourself)

These two steps modify machine state (install a binary, add a local root CA to
your trust store), so they need your explicit action and a security dialog. In
this Claude Code session you can run them inline with the `!` prefix:

```
! winget install FiloSottile.mkcert
! mkcert -install
```

- `winget install FiloSottile.mkcert` - installs the mkcert binary.
- `mkcert -install` - creates a local Certificate Authority and adds it to the
  Windows trust store. Windows shows a security prompt; approve it. This is what
  makes the generated certs "trusted". Reversible later with `mkcert -uninstall`.

Open a fresh terminal afterwards so `mkcert` is on PATH.

## Generate the certificate

```
powershell -File scripts\gen-certs.ps1
```

Writes `frontend/certs/localhost.pem` and `frontend/certs/localhost-key.pem`
(valid for 127.0.0.1, localhost, ::1). These are local-only dev artifacts.

## Run both servers over TLS

```
# Backend (TLS)
powershell -File scripts\run-backend-https.ps1

# Frontend (TLS) - separate terminal
cd frontend
npm run dev:https
```

Then in `frontend/.env.local`, comment the http line and uncomment the https one:

```
# NEXT_PUBLIC_NOOR_API_BASE=http://127.0.0.1:8000
NEXT_PUBLIC_NOOR_API_BASE=https://127.0.0.1:8000
```

Open **https://127.0.0.1:3000** (and the admin view at **https://127.0.0.1:3000/admin**).

## What already supports this (no further edits needed)

- Backend CORS (`backend/app/main.py`) already allows the https origins
  `https://127.0.0.1:3000` and `https://localhost:3000` alongside the http ones.
- `dev:https` is wired in `frontend/package.json` to Next's
  `--experimental-https-key` / `--experimental-https-cert` flags.
- Session cookies still ride `credentials: "include"`; over https on localhost the
  browser accepts them exactly as over http.

## Reverting to HTTP

- Frontend: `npm run dev` (instead of `dev:https`).
- Backend: start uvicorn without the `--ssl-*` flags.
- `.env.local`: restore the http `NEXT_PUBLIC_NOOR_API_BASE` line.
- Remove the local CA entirely (optional): `mkcert -uninstall`.
