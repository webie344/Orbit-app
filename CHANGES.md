# Orbit — Feature Update Instructions

## Files Included
- `features.js` — 10 new features module (drop-in, no build step)
- `features.css` — all styles for the new features

---

## Step 1 — Add to `index.html`

### In `<head>`, add these 3 lines (after your existing `<link rel="stylesheet">`):
```html
<link rel="stylesheet" href="features.css" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
```

### Before `</body>`, add:
```html
<script type="module" src="features.js"></script>
```

### In your reel compose form — DELETE the music picker block:
Find and remove this entire section from the reel form in index.html:
```html
<!-- Everything between these comments — the music-picker-row div and musicTrackList -->
<div class="music-picker-row"> ... </div>
<div id="musicTrackList" class="music-track-list hidden"></div>
```

### Add compose tabs for Build in Public and Project Showcase:
Inside your `.compose-tabs` div, add:
```html
<button class="ct" data-ctab="build"><i class="ri-hammer-line"></i> Build</button>
<button class="ct" data-ctab="project"><i class="ri-folder-5-line"></i> Project</button>
```

### Add compose panes (paste inside your composeModal, after the existing panes):
```html
<!-- Build in Public -->
<form id="buildForm" class="compose-pane hidden">
  <input  type="text"  name="buildTitle"    placeholder="What are you building?" required />
  <textarea            name="buildDesc" rows="3" placeholder="Update / milestone description…"></textarea>
  <div class="build-stage-select">
    <label style="flex:1">Stage
      <select name="buildStage">
        <option value="idea">Idea</option>
        <option value="prototype">Prototype</option>
        <option value="beta">Beta</option>
        <option value="live">Live</option>
      </select>
    </label>
  </div>
  <div class="build-progress-row">
    <span>Progress</span>
    <input type="range" name="buildProgress" min="0" max="100" value="0" />
  </div>
  <div class="build-prog-track"><div class="build-prog-preview"></div></div>
  <div class="compose-actions">
    <button type="submit" class="btn primary">Post update</button>
  </div>
</form>

<!-- Project Showcase -->
<form id="projectForm" class="compose-pane hidden">
  <input  type="text"  name="projectTitle"  placeholder="Project name" required />
  <textarea            name="projectDesc" rows="3" placeholder="What does it do?"></textarea>
  <input  type="url"   name="projectGithub" placeholder="GitHub URL (optional)" />
  <input  type="url"   name="projectLive"   placeholder="Live URL (optional)" />
  <input  type="text"  name="projectTags"   placeholder="Tech stack (comma-separated, e.g. React, Firebase)" />
  <div class="compose-actions">
    <button type="submit" class="btn primary">Showcase</button>
  </div>
</form>
```

---

## Step 2 — Edit `app.js`

### 2a — Remove music from reels

**Delete** the `MUSIC_TRACKS` constant and all related code.
Find each block below and delete it entirely:

**Block 1** — the MUSIC_TRACKS array (~lines 1945–1976):
```js
const MUSIC_TRACKS = [ ... ];  // delete entire array
```

**Block 2** — the _selectedTrack variable (~line 1977):
```js
let _selectedTrack = null;
```

**Block 3** — the openMusicPicker listener (~lines 1978–1994):
```js
document.getElementById("openMusicPicker")?.addEventListener("click", () => { ... });
```

**Block 4** — the clearMusicBtn listener (~lines 1995–2000):
```js
document.getElementById("clearMusicBtn")?.addEventListener("click", () => { ... });
```

**Block 5** — inside the reel form submit handler, find and delete:
```js
if (_selectedTrack) {
  _rd.music = { id: _selectedTrack.id, name: _selectedTrack.name, url: _selectedTrack.url };
  _selectedTrack = null;
}
```

**Block 6** — inside `renderReel`, find and delete the musicBadgeEl variable and its usage:
```js
const musicBadgeEl = r.music
  ? el("div", { class: "reel-music-badge" }, ...)
  : null;
```
And remove `musicBadgeEl,` from the node builder below it.

**Block 7** — inside `renderReels`, delete the _reelAudioMap audio logic:
```js
const _reelAudioMap = {};
// ... and all code referencing _reelAudioMap
```

### 2b — Add new routes to the router

Find the routes array in `app.js` (around line where it defines allowed routes):
```js
const routes = ["feed", "reels", "chats", "groups", "explore", "saved", "settings", "profile", "post", "profile-u", "notifications"];
```
Change it to:
```js
const routes = ["feed", "reels", "chats", "groups", "explore", "saved", "settings", "profile", "post", "profile-u", "notifications", "spaces", "challenges", "mentorship"];
```

Find the router `switch` statement and add three new cases:
```js
case "spaces":
  import("./features.js").then(m => m.renderSpaces(content));
  break;
case "challenges":
  import("./features.js").then(m => m.renderChallenges(content));
  break;
case "mentorship":
  import("./features.js").then(m => m.renderMentorship(content));
  break;
```

### 2c — Dispatch auth-ready event so features.js can initialize

Find the line in app.js where the user is confirmed logged in and `router()` is first called (inside `onAuthStateChanged`). Add this line right after the `router()` call:
```js
document.dispatchEvent(new CustomEvent("orbit:auth-ready"));
```

### 2d — Render Build/Project posts in the feed

In your `renderPost` function (or wherever posts are rendered), add at the top of the function:
```js
if (p.kind === "build") {
  import("./features.js").then(m => root.appendChild(m.renderBuildPost(p, author)));
  return;
}
if (p.kind === "project") {
  import("./features.js").then(m => root.appendChild(m.renderProjectPost(p, author)));
  return;
}
```

### 2e — Render code snippets in posts (optional enhancement)

In your post text rendering, replace the plain `linkify(p.text)` call with:
```js
import("./features.js").then(m => {
  postTextEl.innerHTML = "";
  postTextEl.appendChild(m.renderTextWithCode(p.text));
});
```
Or, since it's synchronous, import at the top of app.js:
```js
import { renderTextWithCode } from "./features.js";
```
Then use `postTextEl.appendChild(renderTextWithCode(p.text))` when rendering post text.

---

## Step 3 — Add to user profile rendering

In your `renderProfile` function, after building the basic profile header, add:

```js
import {
  renderOrbitScoreBadge,
  renderTechStack,
  renderSkillBadges,
} from "./features.js";

// Add score badge next to the user's name
renderOrbitScoreBadge(nameRowElement, uid);

// Add tech stack below bio
renderTechStack(profileContentEl, userDoc, isMe);

// Add skill badges section
renderSkillBadges(profileContentEl, uid, isMe);
```

---

## Firestore Collections Used (auto-created on first use)

| Collection | Purpose |
|---|---|
| `spaces` | Orbit Spaces rooms |
| `spaces/{id}/messages` | Space chat messages |
| `challenges` | Daily challenge docs (keyed by date) |
| `challenges/{date}/entries` | Submitted solutions |
| `mentorship` | User mentorship profiles |
| `users/{uid}/badges` | Skill badges subcollection |

No manual Firestore setup needed — all collections are created automatically on first write.

---

## Feature Summary

| # | Feature | Where it shows |
|---|---|---|
| 1 | Orbit Score | Profile header badge |
| 2 | Code Snippets | Any post with ```code``` blocks |
| 3 | Tech Stack | Profile page section |
| 4 | Build in Public | New compose tab → feed posts |
| 5 | Project Showcase | New compose tab → feed posts |
| 6 | Orbit Spaces | Sidebar nav → /spaces route |
| 7 | Daily Challenges + Leaderboard | Sidebar nav → /challenges route |
| 8 | Skill Badges | Profile page section |
| 9 | Mentorship Matching | Sidebar nav → /mentorship route |
| 10 | Constellation View | Call `renderConstellation(el)` from Explore |
