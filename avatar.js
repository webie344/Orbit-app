// =========================================================================
// Orbit — avatar.js
// Animated Pro Avatars: 20 unique DiceBear characters with wave / idle /
// celebrate CSS animations. Import openAvatarPicker() in settings or profile.
//
// Requires: db and state exported from app.js (no circular issue — avatar.js
// is only ever loaded via dynamic import from app.js, never at startup).
// =========================================================================

import { state, db } from "./app.js";
import {
  doc, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ── 20 pro avatar characters ─────────────────────────────────────────────────
// Each maps to a deterministic DiceBear character via seed + style.
// These MUST stay in sync with the _AV_STYLES lookup table in app.js.
export const PRO_AVATARS = [
  { id: "cosmic-kai",   seed: "cosmic-kai",   style: "adventurer", label: "Cosmic Kai"      },
  { id: "nova-spark",   seed: "nova-spark",   style: "adventurer", label: "Nova Spark"      },
  { id: "orbit-finn",   seed: "orbit-finn",   style: "adventurer", label: "Orbit Finn"      },
  { id: "lunar-mia",    seed: "lunar-mia",    style: "adventurer", label: "Lunar Mia"       },
  { id: "stellar-jay",  seed: "stellar-jay",  style: "adventurer", label: "Stellar Jay"     },
  { id: "pixel-rex",    seed: "pixel-rex",    style: "adventurer", label: "Pixel Rex"       },
  { id: "astro-zoe",    seed: "astro-zoe",    style: "adventurer", label: "Astro Zoe"       },
  { id: "comet-alex",   seed: "comet-alex",   style: "adventurer", label: "Comet Alex"      },
  { id: "nebula-sam",   seed: "nebula-sam",   style: "adventurer", label: "Nebula Sam"      },
  { id: "quasar-lee",   seed: "quasar-lee",   style: "adventurer", label: "Quasar Lee"      },
  { id: "vega-blake",   seed: "vega-blake",   style: "lorelei",    label: "Vega Blake"      },
  { id: "lyra-dev",     seed: "lyra-dev",     style: "lorelei",    label: "Lyra Dev"        },
  { id: "sirius-cj",    seed: "sirius-cj",    style: "lorelei",    label: "Sirius CJ"       },
  { id: "altair-kim",   seed: "altair-kim",   style: "lorelei",    label: "Altair Kim"      },
  { id: "rigel-nova",   seed: "rigel-nova",   style: "lorelei",    label: "Rigel Nova"      },
  { id: "deneb-arc",    seed: "deneb-arc",    style: "micah",      label: "Deneb Arc"       },
  { id: "spica-io",     seed: "spica-io",     style: "micah",      label: "Spica Io"        },
  { id: "mimosa-avy",   seed: "mimosa-avy",   style: "micah",      label: "Mimosa Avy"      },
  { id: "antares-max",  seed: "antares-max",  style: "bottts",     label: "Antares Max"     },
  { id: "polaris-bot",  seed: "polaris-bot",  style: "bottts",     label: "Polaris Bot"     },
];

const dicebearUrl = (av) =>
  `https://api.dicebear.com/7.x/${av.style}/svg?seed=${av.seed}&size=200`;

// ── Avatar picker modal ───────────────────────────────────────────────────────
// Opens a bottom-sheet style modal listing all 20 characters.
// Tapping one saves `animatedAvatarId` to Firestore and state.me immediately.
export function openAvatarPicker() {
  document.getElementById("orbitAvatarPicker")?.remove();

  const overlay = document.createElement("div");
  overlay.id    = "orbitAvatarPicker";
  overlay.className = "modal";
  overlay.style.zIndex = "9999";

  const card = document.createElement("div");
  card.className = "modal-card avp-card";

  // ── Header ────────────────────────────────────────────────────────────────
  const head = document.createElement("div");
  head.className = "modal-head";
  head.innerHTML = `
    <h3>
      <i class="ri-vip-crown-fill" style="color:var(--grad-1);margin-right:6px;"></i>
      Animated Avatar
    </h3>
    <button class="icon-btn" id="avpClose"><i class="ri-close-line"></i></button>`;
  card.appendChild(head);

  const sub = document.createElement("p");
  sub.className   = "avp-subtitle";
  sub.textContent = "Your avatar animates on your profile — waves at visitors, celebrates follows. Pick your character.";
  card.appendChild(sub);

  // ── 20-character grid ─────────────────────────────────────────────────────
  const grid = document.createElement("div");
  grid.className  = "avp-grid";
  const currentId = state.me?.animatedAvatarId || null;

  PRO_AVATARS.forEach((av) => {
    const cell = document.createElement("div");
    cell.className    = `avp-cell${currentId === av.id ? " active" : ""}`;
    cell.dataset.avId = av.id;
    cell.title        = av.label;

    const img = document.createElement("img");
    img.src     = dicebearUrl(av);
    img.alt     = av.label;
    img.loading = "lazy";

    const lbl = document.createElement("span");
    lbl.textContent = av.label;

    cell.appendChild(img);
    cell.appendChild(lbl);

    cell.addEventListener("click", async () => {
      // Optimistic update
      grid.querySelectorAll(".avp-cell").forEach((c) => c.classList.remove("active"));
      cell.classList.add("active");

      try {
        await updateDoc(doc(db, "users", state.uid), { animatedAvatarId: av.id });
        if (state.me) state.me.animatedAvatarId = av.id;
        // Invalidate profile cache so re-navigating shows new avatar
        if (state.cache?.users) state.cache.users.delete(state.uid);

        // Toast — use app's toast if available, otherwise fallback
        const t = document.getElementById("toast");
        if (t) {
          t.textContent = `Avatar set to ${av.label} ✦`;
          t.classList.remove("hidden");
          clearTimeout(openAvatarPicker._tt);
          openAvatarPicker._tt = setTimeout(() => t.classList.add("hidden"), 2400);
        }
      } catch {
        // Roll back on failure
        grid.querySelectorAll(".avp-cell").forEach((c) =>
          c.classList.toggle("active", c.dataset.avId === currentId)
        );
      }
    });

    grid.appendChild(cell);
  });

  card.appendChild(grid);

  // ── Remove avatar row ─────────────────────────────────────────────────────
  if (currentId) {
    const removeWrap = document.createElement("div");
    removeWrap.style.cssText = "padding:4px 20px 20px;text-align:center;";

    const removeBtn = document.createElement("button");
    removeBtn.className  = "btn ghost";
    removeBtn.style.cssText = "font-size:13px;color:var(--text-mute);";
    removeBtn.innerHTML  = `<i class="ri-delete-bin-line"></i> Remove animated avatar`;

    removeBtn.addEventListener("click", async () => {
      await updateDoc(doc(db, "users", state.uid), { animatedAvatarId: null }).catch(() => {});
      if (state.me) state.me.animatedAvatarId = null;
      if (state.cache?.users) state.cache.users.delete(state.uid);
      overlay.remove();
    });

    removeWrap.appendChild(removeBtn);
    card.appendChild(removeWrap);
  }

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  document.getElementById("avpClose").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}
