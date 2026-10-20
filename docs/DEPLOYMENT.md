# Deployment

PaperLens is a single-user, local-first application. The recommended deployment is one Node.js
process (or one Docker container) serving both the API and the built SPA on a loopback address.
Public exposure is opt-in and should be protected with TLS.

All deployment work lives on the **`deploy`** branch. Development happens there too; changes are
merged into `main` only after the user has reviewed and approved them.

---

## Docker (recommended)

Requirements: Docker Engine 24+ with Compose v2.24+ (for optional `env_file`).

```bash
git clone -b deploy git@github.com:Goer17/paper-lens.git
cd paper-lens

# Optional: seed a model or pin a token.
cp .env.example .env
$EDITOR .env

docker compose up -d --build
```

- App: <http://127.0.0.1:8787>
- By default the container publishes only on host loopback (`127.0.0.1:8787`).
- Data is stored in the named volume `paperlens_paperlens-data`.
- `PAPERLENS_BIND` changes the published address, `PAPERLENS_PORT` changes the host port.

Retrieve the generated access token (never commit or share it):

```bash
docker compose exec paperlens cat /data/token.txt
```

If `APP_TOKEN` is set in `.env`, that value is used and no token file is written.

Open <http://127.0.0.1:8787/?token=TOKEN> once; the browser remembers the token.

Useful commands:

```bash
docker compose ps
docker compose logs -f paperlens
docker compose restart paperlens
docker compose down            # keeps the data volume
docker compose down -v         # DESTROYS the library and annotations
```

### Upgrade

```bash
git pull origin deploy
docker compose up -d --build
```

Schema changes are additive and run automatically on startup. Back up the volume before upgrades
that touch `server/src/db.ts`.

### Back up and restore

```bash
# Backup
docker run --rm \
  -v paperlens_paperlens-data:/data:ro \
  -v "$PWD":/backup \
  alpine tar czf /backup/paperlens-data-$(date +%F).tar.gz -C /data .

# Restore (stop the app first)
docker compose stop
docker run --rm \
  -v paperlens_paperlens-data:/data \
  -v "$PWD":/backup \
  alpine sh -c 'rm -rf /data/* && tar xzf /backup/paperlens-data-YYYY-MM-DD.tar.gz -C /data'
docker compose start
```

The archive contains the SQLite database, uploaded PDFs, annotation crops, skills, provider API keys
and the access token. Store it like a secret.

---

## Native Node.js deployment

Requirements: Node.js 22+ (24 LTS recommended) and npm.

```bash
git clone -b deploy git@github.com:Goer17/paper-lens.git
cd paper-lens
npm ci
npm run typecheck
npm run build
npm run smoke

APP_TOKEN="$(openssl rand -base64 32)" \
PAPER_READER_DATA=/var/lib/paperlens \
HOST=127.0.0.1 PORT=8787 \
npm start
```

The API serves `web/dist` on <http://127.0.0.1:8787>. For a persistent service, use a process manager
such as systemd:

```ini
# /etc/systemd/system/paperlens.service
[Unit]
Description=PaperLens
After=network.target

[Service]
Type=simple
User=paperlens
WorkingDirectory=/opt/paperlens
EnvironmentFile=/etc/paperlens.env
ExecStart=/usr/bin/node server/dist/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`/etc/paperlens.env` (mode `600`, owned by `paperlens`):

```dotenv
HOST=127.0.0.1
PORT=8787
PAPER_READER_DATA=/var/lib/paperlens
APP_TOKEN=replace-with-a-long-random-token
# DEEPSEEK_API_KEY=...   # optional debug model seed
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now paperlens
sudo journalctl -u paperlens -f
```

---

## Deploy checklist

Run from the `deploy` branch before merging to `main`:

```bash
npm ci
npm run typecheck
npm run build
npm run smoke
docker compose build
docker compose up -d
curl -fsS http://127.0.0.1:8787/api/health
```

Expected health payload: `{"ok":true,"name":"paperlens","version":"0.1.0"}`.

---

## Public access

The default binding is loopback. To publish PaperLens on every host interface:

```bash
echo 'PAPERLENS_BIND=0.0.0.0' >> .env
docker compose up -d
```

Then allow inbound TCP `8787` in the host firewall / cloud security group and open
`http://<public-ip>:8787`. If port 8787 is not open, set `PAPERLENS_PORT` (for example `80`) in
`.env` before recreating the container.

> **Warning:** plain HTTP sends the access token, PDFs, annotations and chat messages across the
> network unencrypted. The token is a password equivalent: anyone who captures it can read the
> library and spend your configured model credits. For anything beyond a short test, put an HTTPS
> reverse proxy in front of PaperLens and keep the app on loopback.

Example with Caddy on the host (paperlens stays bound to `127.0.0.1:8787`):

```caddyfile
paperlens.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

Caddy obtains and renews the TLS certificate automatically. Alternatively use nginx, Cloudflare
Tunnel or Tailscale Serve. If you use a reverse proxy, do not publish port 8787 publicly.

For a direct public deployment, also:

- set `APP_TOKEN` to a long random value and keep `.env` mode `600`;
- restrict the cloud security group to known source IPs when possible;
- monitor model/provider usage, because a leaked token can trigger paid API calls;
- keep the host OS and Docker patched, and take regular volume backups.

---

## Security notes

- PaperLens is single-user and uses one bearer token. It has no accounts, roles or TLS.
- Keep `HOST=127.0.0.1` for native installs and keep the Compose binding on `127.0.0.1` unless
  public access is explicitly required.
- Public exposure requires `PAPERLENS_BIND=0.0.0.0` (Docker) or `HOST=0.0.0.0` (native). Prefer an
  HTTPS reverse proxy (Caddy, nginx, Cloudflare Tunnel, Tailscale Serve) over direct plain HTTP.
- There is no rate limiting on the login endpoint. Use a long token and restrict network access
  when the app is public.
- Provider API keys are stored in plaintext in the local SQLite database because the app is
  local-first. Protect `PAPER_READER_DATA` and the Docker volume accordingly.
- `APP_TOKEN`, provider keys and files under the data directory must never be committed or logged.
- The container runs as the unprivileged `node` user with all Linux capabilities dropped and
  `no-new-privileges` enabled.
