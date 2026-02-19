/* BSKRaffle – Bluesky Raffle App */

const BSKY_API = "https://public.api.bsky.app/xrpc";
const BSKY_AUTH_API = "https://bsky.social/xrpc";
const MENTION_HANDLE = "parisjug.org";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ── State ──────────────────────────────────────────
let eligiblePosts = [];
let currentWinner = null;
let accessJwt = null;

// ── DOM refs ───────────────────────────────────────
const handleInput     = document.getElementById("handle-input");
const passwordInput   = document.getElementById("password-input");
const loginBtn        = document.getElementById("login-btn");
const authStatus      = document.getElementById("auth-status");
const searchInput     = document.getElementById("search-input");
const searchBtn       = document.getElementById("search-btn");
const statusDiv       = document.getElementById("status");
const raffleBtn       = document.getElementById("raffle-btn");
const winnerSection   = document.getElementById("winner-section");
const errorDiv        = document.getElementById("error-msg");

// ── Helpers ────────────────────────────────────────

/**
 * Authenticate with Bluesky using handle + App Password.
 * Stores the access JWT for subsequent API calls.
 */
async function login(handle, appPassword) {
  const res = await fetch(`${BSKY_AUTH_API}/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Authentication failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  accessJwt = data.accessJwt;
}

function showError(msg) {
  errorDiv.textContent = msg;
  errorDiv.classList.remove("hidden");
}

function clearError() {
  errorDiv.classList.add("hidden");
  errorDiv.textContent = "";
}

function setStatus(html) {
  statusDiv.innerHTML = html;
}

/**
 * Returns true when the post has at least one image embed.
 */
function hasImage(post) {
  const embed = post.embed;
  if (!embed) return false;
  const t = embed.$type || "";
  if (t === "app.bsky.embed.images#view") return true;
  // Wrapped inside a record+media or external embed
  if (t === "app.bsky.embed.recordWithMedia#view" && embed.media) {
    return (embed.media.$type === "app.bsky.embed.images#view");
  }
  return false;
}

/**
 * Returns true when the post is at least 1 week old.
 */
function isOldEnough(post) {
  const created = new Date(post.record.createdAt || post.indexedAt);
  return (Date.now() - created.getTime()) >= ONE_WEEK_MS;
}

/**
 * Extract images array from a post embed.
 */
function getImages(post) {
  const embed = post.embed;
  if (!embed) return [];
  if (embed.$type === "app.bsky.embed.images#view") return embed.images || [];
  if (
    embed.$type === "app.bsky.embed.recordWithMedia#view" &&
    embed.media &&
    embed.media.$type === "app.bsky.embed.images#view"
  ) {
    return embed.media.images || [];
  }
  return [];
}

/**
 * Build an AT-URI-based bsky.app URL for the post.
 */
function postUrl(post) {
  // at://did:plc:xyz/app.bsky.feed.post/rkey
  const uri = post.uri; // "at://did.../app.bsky.feed.post/rkey"
  const parts = uri.replace("at://", "").split("/");
  const did   = parts[0];
  const rkey  = parts[2];
  const handle = post.author.handle;
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

/**
 * Fetch all matching posts from the Bluesky search API.
 * Paginates up to `maxPosts` to gather a reasonable pool.
 */
async function fetchPosts(query, maxPosts = 200) {
  const posts = [];
  let cursor = null;
  const headers = { "Authorization": `Bearer ${accessJwt}` };

  while (posts.length < maxPosts) {
    const params = new URLSearchParams({ q: query, limit: "100" });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`${BSKY_API}/app.bsky.feed.searchPosts?${params}`, { headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Bluesky API error ${res.status}: ${body}`);
    }
    const data = await res.json();
    if (!data.posts || data.posts.length === 0) break;
    posts.push(...data.posts);
    cursor = data.cursor;
    if (!cursor) break;
  }
  return posts;
}

/**
 * Format a date as a short human-readable string.
 */
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Build the Bluesky compose URL pre-filled with the announcement text.
 */
function buildComposeUrl(text) {
  return `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`;
}

/**
 * Build the announcement text for the winning post.
 */
function buildAnnouncement(winner) {
  const handle = winner.author.handle;
  const url = postUrl(winner);
  return `🎉 Congratulations @${handle}!\n\nYou won the raffle! 🏆\n\n${url}\n\n@${MENTION_HANDLE}`;
}

// ── Render winner ──────────────────────────────────

function renderWinner(post) {
  const images    = getImages(post);
  const url       = postUrl(post);
  const created   = post.record.createdAt || post.indexedAt;
  const avatarSrc = post.author.avatar || "";
  const name      = post.author.displayName || post.author.handle;
  const handle    = post.author.handle;
  const text      = post.record.text || "";
  const announce  = buildAnnouncement(post);

  let imagesHtml = "";
  if (images.length === 1) {
    imagesHtml = `<img class="post-image" src="${escHtml(images[0].thumb)}" alt="${escHtml(images[0].alt || "Post image")}" loading="lazy">`;
  } else if (images.length > 1) {
    imagesHtml = `<div class="post-image-grid">` +
      images.map(img => `<img src="${escHtml(img.thumb)}" alt="${escHtml(img.alt || "Post image")}" loading="lazy">`).join("") +
      `</div>`;
  }

  winnerSection.innerHTML = `
    <div class="card" id="winner-card">
      <p class="section-title"><span class="confetti">🎊</span> Raffle Winner!</p>

      <div class="winner-header">
        ${avatarSrc ? `<img class="avatar" src="${escHtml(avatarSrc)}" alt="${escHtml(name)}">` : ""}
        <div class="author-info">
          <div class="display-name">${escHtml(name)}</div>
          <div class="handle">@${escHtml(handle)}</div>
        </div>
        <span class="post-date">${formatDate(created)}</span>
      </div>

      ${text ? `<p class="post-text">${escHtml(text)}</p>` : ""}
      ${imagesHtml}

      <div class="winner-actions">
        <a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer" class="original-link">
          View original post ↗
        </a>
      </div>

      <div class="compose-box">
        <label>🚀 Ready to post on Bluesky</label>
        <p class="compose-text">${escHtml(announce)}</p>
        <a class="btn-share" href="${escHtml(buildComposeUrl(announce))}" target="_blank" rel="noopener noreferrer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9l20-7z"/>
          </svg>
          Post on Bluesky
        </a>
      </div>
    </div>
  `;
  winnerSection.classList.remove("hidden");
  winnerSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Minimal HTML escaping to prevent XSS from API data.
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Event: Login ───────────────────────────────────

loginBtn.addEventListener("click", async () => {
  const handle = handleInput.value.trim();
  const password = passwordInput.value.trim();
  if (!handle || !password) {
    authStatus.textContent = "Please enter both your handle and App Password.";
    authStatus.className = "auth-error";
    return;
  }
  loginBtn.disabled = true;
  authStatus.textContent = "Connecting…";
  authStatus.className = "auth-info";
  let success = false;
  try {
    await login(handle, password);
    success = true;
    authStatus.textContent = `✓ Connected as @${handle}`;
    authStatus.className = "auth-success";
    handleInput.disabled = true;
    passwordInput.value = "";
    passwordInput.disabled = true;
    searchBtn.disabled = false;
    searchInput.focus();
  } catch (err) {
    authStatus.textContent = err.message;
    authStatus.className = "auth-error";
  } finally {
    if (!success) loginBtn.disabled = false;
  }
});

// Allow pressing Enter in the login inputs
[handleInput, passwordInput].forEach(el => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loginBtn.click();
  });
});

// ── Event: Search ──────────────────────────────────

searchBtn.addEventListener("click", async () => {
  const query = searchInput.value.trim();
  if (!query) {
    showError("Please enter a hashtag or keyword to search.");
    return;
  }
  clearError();
  eligiblePosts = [];
  currentWinner = null;
  winnerSection.classList.add("hidden");
  winnerSection.innerHTML = "";
  raffleBtn.disabled = true;

  searchBtn.disabled = true;
  setStatus(`<span class="spinner"></span> Searching Bluesky for <strong>${escHtml(query)}</strong>…`);

  try {
    const allPosts = await fetchPosts(query);
    eligiblePosts = allPosts.filter(p => hasImage(p) && isOldEnough(p));

    if (eligiblePosts.length === 0) {
      setStatus(
        `<span>No eligible posts found for <strong>${escHtml(query)}</strong>. ` +
        `Posts must be at least 1 week old and contain an image.</span>`
      );
    } else {
      setStatus(
        `<span>Found <span class="badge">${eligiblePosts.length}</span> ` +
        `eligible post${eligiblePosts.length !== 1 ? "s" : ""} ` +
        `(with image, ≥ 1 week old) out of ${allPosts.length} total for ` +
        `<strong>${escHtml(query)}</strong>. Ready to raffle!</span>`
      );
      raffleBtn.disabled = false;
    }
  } catch (err) {
    showError(`Failed to fetch posts: ${err.message}`);
    setStatus("");
  } finally {
    searchBtn.disabled = false;
  }
});

// Allow pressing Enter in the search box
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchBtn.click();
});

// ── Event: Raffle ──────────────────────────────────

raffleBtn.addEventListener("click", () => {
  if (eligiblePosts.length === 0) return;
  const idx = Math.floor(Math.random() * eligiblePosts.length);
  currentWinner = eligiblePosts[idx];
  renderWinner(currentWinner);
});
