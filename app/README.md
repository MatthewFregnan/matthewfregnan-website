# Portfolio Manager

Desktop app for adding and editing projects on matthewfregnan.com. Runs on macOS and Windows.

## Open it

- **Mac:** double-click `app/run.command`. If macOS blocks it the first time, right-click it, choose **Open**, then **Open** again.
- **Windows:** double-click `app\run.bat`. You need Python 3.10+ from python.org; tick "Add to PATH" when installing it.

The first launch installs what the app needs (about a minute). After that it opens straight away.

**Preview Site** also needs Node.js. **Publish** needs Git with access to the GitHub repo.

## Finding your way around

Both the app and the web admin have the same left menu:

- **Overview** (opens first): unpublished changes, anything that needs fixing (videos not playing, missing thumbnails), which home page set is live with a small preview, your projects, and video storage.
- **Projects**: the project list and editor. The **Page Preview** tab shows the project page as it will look (laptop or phone, Standard or Detailed layout) and its tile in lists.
- **Home Page**: your sets and their settings, with a live preview of the home page beside them. **Shuffle Again** shows another random mix when shuffle is on; click any project in the preview to edit it.
- **Storage**: how much of the free 10 GB of video storage is used.

## Day to day

- **New from Link** (⌘N / Ctrl+N): paste a Vimeo, YouTube or Instagram link. The app looks the video up, fills in the title, year and thumbnail, and picks Vertical for portrait videos. You add the client and production.
- **Changes save automatically.** Everything can be undone (⌘Z / Ctrl+Z), including deleting a project.
- **Publish** shows how many changes aren't live yet, e.g. *Publish (2)*. Click it to see them in plain English and put them live.
- **Reorder** projects by dragging them in the list, or with ⌘↑ / ⌘↓. The order is the order on the website.
- Client, Role and Production suggest values you've used before.
- Backup video links and the stills gallery stay hidden until you need them (*+ Add a backup link*, *+ Add stills*).

## Adding a video

**Easiest: Upload Video File…** in the project's Video section (or drop a video file on the player). Any file works: a ProRes or 4K master, a phone video, a reel you've saved from your own Instagram. The app:

1. checks the file, and if it's already a web-ready 1080p H.264 MP4 just tidies it so it starts playing instantly, otherwise converts it to a high-quality 1080p web video (keeping it under the 300 MB upload limit);
2. uploads it to videos.matthewfregnan.com;
3. links it as the project's Video file. Press **Publish** to put it live.

It needs ffmpeg (`brew install ffmpeg`) and Wrangler signed in once (`npx wrangler@3 login`).

**From the web admin:** the same **Upload Video File…** button (or drop a file on the player). The browser converts the video itself (4K, HEVC/iPhone, MOV → 1080p H.264 MP4; files that are already web-ready aren't re-encoded) and uploads it in chunks to the upload service at upload.matthewfregnan.com, which only accepts your signed-in GitHub token. Keep the tab open until it finishes (you can keep editing other projects meanwhile). Limits: up to 1 GB, and **ProRes doesn't work in browsers**: use the desktop app for ProRes masters, or export an H.264 MP4. Chrome or Edge convert fastest.

Every upload gets a new address (e.g. `…/project-name-mwrf2klb.mp4`), so the live site keeps showing the old video until you **Publish**, and **Undo** brings the old one back. Replaced files stay in storage; delete them in the Cloudflare dashboard if you ever want the space back.

**Exporting so no conversion is needed:** H.264 MP4, 1080p (or 1080×1920 for vertical), around 8–10 Mbps, AAC audio.

**Thumbnails and stills from the video:** **Pick from Video…** (desktop app and web admin) lets you scrub to any frame of the project's hosted video and use it as the thumbnail or add it to the stills.

## Videos

**Your own video files come first.** Videos are stored in Cloudflare R2 (free up to 10 GB, no charge for views) at `https://videos.matthewfregnan.com/<category>/<project>.mp4` and play in the site's own player: no ads, no logos. To add one:

1. Export a 1080p H.264 MP4 (around 8–10 Mbps is plenty).
2. Upload it in the Cloudflare dashboard: **R2 Object Storage → matthewfregnan-videos**, into the right category folder (`commercial`, `branded` or `vertical`).
3. Paste its address (`https://videos.matthewfregnan.com/branded/my-project.mp4`) into the project's video box.

Or from Terminal (Wrangler 3, since this Mac has Node 20):

```
npx wrangler@3 r2 object put matthewfregnan-videos/branded/my-project.mp4 --file my-project.mp4 --content-type video/mp4 --cache-control "public, max-age=86400"
```

Vimeo, YouTube and Instagram links still work, as backups or on their own:

Each project can have a **Video file**, **Vimeo**, **YouTube** and **Instagram** link. Choose which one to **show first**; the others are backups.

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

Open **https://matthewfregnan.com/admin/** to edit from your phone or any computer. It looks and works like this app: the project list on the left, details on the left of the editor, and the video player, thumbnail and stills on the right.

- **New from Link**, the coloured status dots, **Check Videos**, backup links, **Show first**, view counts, drag to reorder, and undo/redo all work the same as here.
- Images you add are resized and converted to WebP in the browser.
- **Edits stay in this browser until you press Publish**, which saves everything to GitHub in one go. The site updates 1–2 minutes later. Unpublished edits (and new images) survive closing the tab.

**Signing in.** Only someone who can write to the GitHub repo can save, so the page is safe even though anyone can open it. Nothing secret is stored in the site itself. The first time on each device, paste a GitHub token:

1. Go to github.com → your profile picture → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name it "Portfolio admin" and set an expiry (a year is fine).
3. Under **Repository access**, choose *Only select repositories* → `matthewfregnan-website`.
4. Under **Permissions → Repository permissions**, set **Contents** to *Read and write*.
5. Generate it, copy it, and paste it into the admin page. The browser remembers it. Use **⋯ → Sign Out** on shared computers.

**Using both.** When this app opens, it downloads any edits published from the web (unless you have unpublished changes here). Publishing from the app pulls web edits in first. If the project list was changed in both places, the web admin won't overwrite it: it asks you to reload first.

**The upload service** (`upload-worker/`) is a small Cloudflare Worker with the video bucket attached, so no storage keys are ever in a web page. It checks each upload's GitHub token can write to this repo. To update it after changing its code: `cd upload-worker && npx wrangler@3 deploy`. To test it locally with simulated storage: put `TEST_TOKEN=anything` in `upload-worker/.dev.vars`, run `npx wrangler@3 dev`, and open the admin at `http://localhost:…/admin/?demo&upload=http://localhost:8787&uploadToken=anything`.
