# Web app hosting: app.htnq.org

The browser version of HTNQ Trading Checklist is published to **GitHub Pages**
from this repository by [`.github/workflows/deploy-web.yml`](../.github/workflows/deploy-web.yml)
and served at **https://app.htnq.org**. The Windows desktop app is unchanged.
There is no macOS desktop build: Mac users use the web app.

| Address | What happens |
| --- | --- |
| `https://app.htnq.org` | The web app. This is what users see in the address bar. |
| `https://htnq.org/mentorship-home` | Squarespace sends a permanent (301) redirect to `https://app.htnq.org`. The address bar then shows `app.htnq.org`. |
| `https://athamer736.github.io/htnqbeta.github.io/` | Old address. Replace its `index.html` with [`web-redirect/index.html`](web-redirect/index.html) so bookmarks land on `app.htnq.org`. |

Squarespace cannot serve an external app *under a path* of the Squarespace
site (`htnq.org/mentorship-home` showing the app itself), which is why the app
lives on the `app` subdomain and the path is a redirect.

## Status

| Step | State |
| --- | --- |
| Workflow, CNAME file and redirect page written | Implemented (this branch) |
| Workflow run on GitHub | Not run. It runs on the first push to `main` after merge, or manually from the Actions tab. |
| DNS, Pages, Squarespace and Supabase settings below | Owner action. Not done by the agent. |
| `https://app.htnq.org` serving the app over HTTPS | Not verified |

## One-time owner steps

Do these in order. Nothing here needs a secret pasted into chat.

### 1. Repository variables (GitHub)

**Settings → Secrets and variables → Actions → Variables → New repository variable**:

- `VITE_SUPABASE_URL` = your Supabase Project URL, exactly `https://<project-ref>.supabase.co`
  (not the `/rest/v1/` API URL; with a path on it, Discord sign-in fails with
  "No API key found in request")
- `VITE_SUPABASE_ANON_KEY` = your Supabase **anon / publishable** key

These two are public by design (they ship in every browser build). Never add
the service-role key, the Discord bot token, Bunny keys, the mentorship API
token or any other private credential as a `VITE_` variable. Those belong only in
**Supabase → Edge Functions → Secrets**.

The workflow stops with an error if either variable is missing, so an unconfigured
build is never published.

### 2. DNS (Squarespace)

**Squarespace → Settings → Domains → htnq.org → DNS → Custom records → Add record**:

| Host | Type | Data |
| --- | --- | --- |
| `app` | `CNAME` | `athamer736.github.io` |

Leave the existing Squarespace records alone. Recommended: verify `htnq.org` for your
GitHub account (**GitHub → Settings → Pages → Add a domain**) so no other GitHub user
can claim the subdomain.

### 3. GitHub Pages

**Repository → Settings → Pages**:

1. **Build and deployment → Source**: `GitHub Actions`.
2. Run the workflow once (**Actions → Deploy web app → Run workflow**), or merge to `main`.
3. **Custom domain**: `app.htnq.org` → Save. Wait for the DNS check to pass.
4. Tick **Enforce HTTPS** once GitHub has issued the certificate (can take up to an hour or so after DNS resolves).

### 4. Supabase sign-in URLs

**Supabase → Authentication → URL Configuration**:

- **Site URL**: `https://app.htnq.org`
- **Redirect URLs**: add `https://app.htnq.org/` and keep `http://127.0.0.1:53123` (desktop sign-in).
  Keep the old `github.io` URL until the cutover is finished, then remove it.

Discord's own OAuth redirect stays `https://<project-ref>.supabase.co/auth/v1/callback`; it does not change.

### 5. Squarespace redirect

**Squarespace → Settings → Developer tools → URL mappings**, add:

```
/mentorship-home -> https://app.htnq.org 301
```

### 6. Old address

Copy [`web-redirect/index.html`](web-redirect/index.html) over `index.html` in the
`athamer736/htnqbeta.github.io` repository (this branch does not touch that repository).

## Moving existing web users

Browsers keep local data per address. Anything a user saved in the browser at the old
`github.io` address does **not** appear automatically at `app.htnq.org`:

- **Signed in with cloud sync on**: sign in at the old address once more and let sync
  finish, then sign in at `app.htnq.org`. Synced journal and data-collection entries
  download again.
- **Local only**: **Data Collection → Export** at the old address and **Import** at
  `app.htnq.org` moves data-collection entries. There is no export for the trade
  journal, so local-only journal entries move only by turning on cloud sync at the old
  address first. Do this before swapping in the redirect page.

The Windows desktop app keeps its data on the PC and is not affected.

## Checking it worked

1. `https://app.htnq.org` loads over HTTPS with a valid certificate.
2. Sign in with Discord in the browser and land back on `app.htnq.org` (not `github.io`).
3. `https://htnq.org/mentorship-home` ends on `https://app.htnq.org`.
4. The old `github.io` address ends on `https://app.htnq.org`.
5. A mentorship video plays with the watermark in the browser (see [`launch-checklist.md`](launch-checklist.md)).
