# Maalam PH — installable app (PWA)

This folder is the version families install on their phone, tablet or computer.
It talks to your Apps Script web app:

`https://script.google.com/macros/s/AKfycbxZB8Go9WgEABH8iZqJNQ3p7ttQnD-KSpwooPolTHsK4LNC79EcpZzofntqO1Le4ebv/exec`

## 1. Update Apps Script first
1. Paste the new `Code.gs` and `GameJs` into your Apps Script project and Save.
2. **Deploy → Manage deployments → ✏️ Edit** (the existing deployment) → Version: **New version** → Deploy.
   Always *edit* this deployment. A *new* deployment gets a different link and the app would stop working.
3. Access must stay **Execute as: Me** and **Who has access: Anyone**.

## 2. Put the app on GitHub Pages
1. Create a free account at github.com, then **New repository** → name it `maalam-ph` → **Public** → Create.
2. Click **uploading an existing file**, drag in **everything inside this folder** (including the `icons` and
   `vendor` folders and the `.nojekyll` file), then **Commit changes**.
3. Repository **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → Save.
4. After about a minute your app is live at `https://YOUR-USERNAME.github.io/maalam-ph/`.
5. In the game Sheet, set **Config → webAppUrl** to that address (GCash/PayMongo sends families back there).

## 3. How families install it
- **Android (Chrome):** an **Install** banner appears at the bottom. Tap it.
- **iPhone/iPad (Safari):** the banner says: tap **Share ⬆️ → Add to Home Screen**.
- **Computer (Chrome/Edge):** Install banner, or the install icon in the address bar.

## 4. Offline play
- The game itself (pages, 3D, questions, stories) is saved on the device the first time it opens.
- On the map, **📥 Download for offline** saves every picture and AI voice clip (do this on Wi-Fi).
- Offline, children can play, read Grimoires and their bought Library books. Progress is kept on the
  device and synced automatically when the internet comes back.
- These always need the internet: sign up / sign in, GCash payments, top ups, buying books,
  Emergency Grimoire, videos, and new AI voice lines (the device voice is used instead).

## 5. When you change the game later
1. Replace the changed files here (for example `game.js` = the new `GameJs` content).
2. Open `sw.js` and change `VERSION` (for example `maalam-app-v1` → `maalam-app-v2`), then commit.
   This makes every installed app pick up the new version.

## Files
| File | What it is |
|---|---|
| `index.html` | The app page (styles, top bar, install banner) |
| `game.js` | The game (same code as the Apps Script `GameJs` file) |
| `vendor/three.min.js` | 3D engine, kept locally so it works offline |
| `manifest.webmanifest` | App name, colors and icons for installing |
| `sw.js` | Service worker: saves the app for offline use |
| `icons/` | App icons made from the Maalam PH logo |
| `.nojekyll` | Tells GitHub Pages to serve every file as-is |
