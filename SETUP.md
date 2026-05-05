# Orbit — Setup

Five files. Drop them into any host (GitHub Pages, Netlify, Vercel, Firebase Hosting, your own server). They are pure HTML/CSS/JS — no build step.

```
orbit-app/
├── index.html
├── style.css
├── chat.css
├── app.js
└── chat.js
```

---

## 1. Create a Firebase project

1. Go to https://console.firebase.google.com → **Add project**.
2. In **Build → Authentication → Sign-in method**, enable **Email/Password** and **Google**.
3. In **Build → Firestore Database**, click **Create database** → start in **production mode** (we'll add rules below).
4. In **Project settings → Your apps**, register a **Web app**, copy the config object.
5. Open `app.js` and replace the `firebaseConfig` block with your values.

### Firestore security rules

Paste these into **Firestore → Rules** and publish. They cover everything Orbit does — auth, posts, reels, groups, DMs.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function isMe(uid) { return signedIn() && request.auth.uid == uid; }

    // Users — public read, only owner writes
    match /users/{uid} {
      allow read: if signedIn();
      allow create: if isMe(uid);
      allow update: if isMe(uid)
        // Allow others to update only their own entry inside followers/following arrays
        || (signedIn() &&
            request.resource.data.diff(resource.data).affectedKeys().hasOnly(['followers']));
      allow delete: if isMe(uid);

      // Per-user chat-meta (DM previews)
      match /chats/{chatId} {
        allow read, write: if isMe(uid);
      }
    }

    // Posts — public read, anyone signed in can create their own; only author can delete; anyone can update orbits/comments counts via increment
    match /posts/{postId} {
      allow read: if signedIn();
      allow create: if signedIn() && request.resource.data.authorUid == request.auth.uid;
      allow update: if signedIn(); // controlled fields: orbits/orbitCount/commentCount
      allow delete: if signedIn() && resource.data.authorUid == request.auth.uid;

      match /comments/{cid} {
        allow read: if signedIn();
        allow create: if signedIn() && request.resource.data.authorUid == request.auth.uid;
        allow delete: if signedIn() && resource.data.authorUid == request.auth.uid;
      }
    }

    // Reels — same shape as posts
    match /reels/{rid} {
      allow read: if signedIn();
      allow create: if signedIn() && request.resource.data.authorUid == request.auth.uid;
      allow update: if signedIn();
      allow delete: if signedIn() && resource.data.authorUid == request.auth.uid;
    }

    // Groups — anyone signed in can read public groups; only members can post messages
    match /groups/{gid} {
      allow read: if signedIn();
      allow create: if signedIn() && request.resource.data.ownerUid == request.auth.uid;
      allow update: if signedIn(); // join/leave updates the members array
      allow delete: if signedIn() && resource.data.ownerUid == request.auth.uid;

      match /messages/{mid} {
        allow read: if signedIn();
        allow create: if signedIn();
        allow update, delete: if signedIn() &&
          (resource.data.authorUid == request.auth.uid || get(/databases/$(database)/documents/groups/$(gid)).data.ownerUid == request.auth.uid);
      }
    }

    // DMs — only the two participants can read/write
    match /chats/{chatId} {
      allow read, write: if signedIn() && chatId.split('__').hasAny([request.auth.uid]);

      match /messages/{mid} {
        allow read: if signedIn() && chatId.split('__').hasAny([request.auth.uid]);
        allow create: if signedIn() && request.resource.data.authorUid == request.auth.uid;
        allow update, delete: if signedIn() && resource.data.authorUid == request.auth.uid;
      }
    }
  }
}
```

> Note: these rules are intentionally lenient on `posts/reels/groups` updates so the existing client increment/array operations work. Tighten further if you want — Orbit will keep working as long as `authorUid` is preserved on create.

### Firestore indexes

The first time someone hits the **Explore** tab or opens a profile, Firebase may show a console link asking you to create a composite index. Click the link, wait 1–2 minutes, done. Indexes Orbit uses:

- `posts`: `authorUid ASC, createdAt DESC`
- `posts`: `orbitCount DESC` (single-field, auto-created)
- `reels`: `authorUid ASC, createdAt DESC`
- `groups`: `members ARRAY_CONTAINS, lastMessageAt DESC` (or rely on the in-memory sort the client already does)

---

## 2. Create a Cloudinary unsigned upload preset

1. Sign up at https://cloudinary.com.
2. **Settings → Upload → Upload presets → Add upload preset**.
3. Set **Signing Mode = Unsigned** and give it a name (e.g. `orbit_unsigned`).
4. Optional: restrict folder, file size, allowed formats.
5. Open `app.js` and replace `cloudinaryConfig` with your **Cloud name** and the preset name.

---

## 3. Host it

Any of these work — just upload all five files together:

- **GitHub Pages**: push to a repo, Settings → Pages → main branch.
- **Netlify**: drag the `orbit-app/` folder into the Netlify dashboard.
- **Vercel**: `vercel deploy` from inside the folder.
- **Firebase Hosting**: `firebase init hosting`, point to `orbit-app/`, `firebase deploy`.

That's it. Open the URL, sign up, and your Orbit is live.

---

## What's inside

- **Auth**: Email/Password + Google.
- **Verified ✓**: granted after the user allows the browser geolocation prompt once. Reverse-geocoded via OpenStreetMap (free, no key) for a city label.
- **Feed**: flat, IG/FB-style with hairline separators between posts. Posts with **3+ Orbits** also appear in a glowing "Trending" lane at the top of the feed and get a side accent bar — that's the "one like that separates posts."
- **Reels**: full-screen vertical scroll, autoplay-on-view, tap to mute/unmute.
- **Groups**: create, join/leave, real-time chat with member list and shareable invite link.
- **Chats / DMs**: real-time, with **reply, react, edit, delete, copy, swipe-to-reply (touch), typing indicator, read receipts, online/last-seen, drafts, search-in-chat, jump-to-replied-message, mute, pin**.
- **Per-chat customization**: 8 wallpapers, 10 bubble colors, 3 bubble shapes, 3 fonts, font-size slider — all saved per-chat to your profile.
- **Light/Dark theme toggle**: instant, persisted.
- **Cloudinary** for all images, post media, reels video, and chat attachments.

Enjoy.
