# Portfolio Manager

Desktop app for adding and editing projects on matthewfregnan.com. Runs on macOS and Windows.

## Open it

- **Mac:** double-click `app/run.command`. If macOS blocks it the first time, right-click it, choose **Open**, then **Open** again.
- **Windows:** double-click `app\run.bat`. You need Python 3.10+ from python.org; tick "Add to PATH" when installing it.

The first launch installs what the app needs (about a minute). After that it opens straight away.

**Preview Site** also needs Node.js. **Publish** needs Git with access to the GitHub repo.

## Day to day

- **New from Link** (⌘N / Ctrl+N): paste a Vimeo, YouTube or Instagram link. The app looks the video up, fills in the title, year and thumbnail, and picks Vertical for portrait videos. You add the client and production.
- **Changes save automatically.** Everything can be undone (⌘Z / Ctrl+Z), including deleting a project.
- **Publish** shows how many changes aren't live yet, e.g. *Publish (2)*. Click it to see them in plain English and put them live.
- **Reorder** projects by dragging them in the list, or with ⌘↑ / ⌘↓. The order is the order on the website.
- Client, Role and Production suggest values you've used before.
- Backup video links and the stills gallery stay hidden until you need them (*+ Add a backup link*, *+ Add stills*).

## Videos

Each project can have a **Vimeo**, **YouTube** and **Instagram** link. Choose which one to **show first**; the others are backups.

- The app checks each link and puts a dot next to each project in the list: green = plays, orange = the first choice is broken but a backup plays, red = nothing plays, grey = not checked yet, or an Instagram link (those can't be checked).
- The website does the same check: every build starts on the first link that works, and the page re-checks in the visitor's browser, switching to a backup if a video broke after the last build.
- Instagram links can't be checked automatically, so the site only falls back to Instagram after Vimeo and YouTube. Make sure the post is public.
- Paste any link into any of the three boxes. A YouTube link pasted in the Vimeo box moves itself to the YouTube box.

## View counts

Tick **Show view count on the project page** for a project to show views (and likes) under its video. The counts come from whichever video is playing (YouTube or Vimeo; Instagram doesn't offer them) and are fetched each time the site builds. The site rebuilds automatically every morning.

This only works after you add your keys to GitHub, under the repo's **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Where to get it |
|---|---|
| `YOUTUBE_API_KEY` | Google Cloud Console → create a project → enable **YouTube Data API v3** → Credentials → **Create API key**. Restrict it to that API. Free. |
| `VIMEO_TOKEN` | developer.vimeo.com/apps → create an app → **Generate an access token** (Authenticated, scope **Public** + **Private**). |

Without the keys, nothing breaks; the counts just don't appear. To see counts in a local preview, set the same names as environment variables before running `npm run build`.

## Package as a standalone app (optional)

```
app/.venv/bin/pip install pyinstaller
app/.venv/bin/pyinstaller --windowed --name "Portfolio Manager" app/main.py
```

Run it on each OS to get a `.app` (Mac) or `.exe` (Windows) in `dist/`. Keep the app inside the website folder, or point it at the folder the first time it opens.

## Web admin (edit from any browser)

Open **https://matthewfregnan.com/admin/** to edit projects from your phone or any computer. It edits the same `data/projects.json` as this app, and every save goes live a minute or two later.

**Signing in.** Only someone who can write to the GitHub repo can save anything, so the page is safe even though anyone can open it. To sign in, use **Sign In Using Access Token**:

1. On GitHub: your profile picture → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name it "Portfolio admin" and set an expiry (a year is fine).
3. Under **Repository access**, choose *Only select repositories* → `matthewfregnan-website`.
4. Under **Permissions → Repository permissions**, set **Contents** to *Read and write*.
5. Generate it, copy it, and paste it into the admin page. The browser remembers it, so you only do this once per device.

The **Sign In with GitHub** button needs a small extra login service (Sveltia's Cloudflare Worker), which isn't set up, so use the token button instead. In Chrome or Edge on this computer you can also use **Work with Local Repository** and pick this folder, which needs no token; you'd then publish with this app.

**Using both.** When this app opens, it downloads any edits made on the web (unless you have unpublished changes). Publishing from the app also pulls web edits in first. If the same project was edited in both places, Publish stops and shows the conflict rather than overwriting anything.

**Web admin vs this app:** the web admin can edit text, swap video links, and upload images (converted to WebP). It can't check whether links play, look videos up from a link, or show the coloured status dots. Use this app for those.
