// shared/client.js
function pageKey(url) {
  const u = new URL(url);
  u.hash = "";
  return u.href;
}

// browser/popup.js
var $ = (id) => document.getElementById(id);
async function render() {
  const s = (await chrome.storage.local.get("settings")).settings || {};
  $("login").hidden = !!s.session;
  $("signed").hidden = !s.session;
  $("account").textContent = s.session?.user.email || "";
}
async function send(m) {
  $("status").textContent = "Working\u2026";
  const r = await chrome.runtime.sendMessage(m);
  if (r.error) throw Error(r.error);
  return r;
}
function task(fn) {
  return async (e) => {
    e?.preventDefault();
    try {
      await fn();
      await render();
      await listHighlights();
    } catch (e2) {
      $("status").textContent = e2.message;
    }
  };
}
$("login").onsubmit = task(async () => {
  await send({ type: "login", email: $("email").value, password: $("password").value });
  $("password").value = "";
  $("status").textContent = "Signed in. Revisit your article to restore highlights.";
});
$("logout").onclick = task(async () => {
  await send({ type: "logout" });
  $("status").textContent = "Signed out. Local queued clippings remain tied to your account.";
});
$("sync").onclick = task(async () => {
  await send({ type: "sync" });
  const s = (await chrome.storage.local.get("settings")).settings;
  const q = (await chrome.storage.local.get("queue:" + s.session.user.id))["queue:" + s.session.user.id] || [];
  $("status").textContent = q.length ? `${q.length} clipping(s) pending. ${(await chrome.storage.local.get("lastAction")).lastAction?.message || ""}` : "All queued clippings saved.";
});
$("zotero").onclick = task(async () => {
  const s = (await chrome.storage.local.get("settings")).settings || {};
  if (!s.zoteroUser || !s.zoteroKey) throw Error("Add your Zotero user ID and read-only API key in settings first.");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const r = await send({ type: "zotero", page: pageKey(tab.url) });
  $("status").textContent = `${r.count} clipping(s) linked. No exact match or duplicate matches remain unlinked.`;
});
void render();
async function showLastAction() {
  const { lastAction } = await chrome.storage.local.get("lastAction");
  if (lastAction) $("status").textContent = lastAction.message;
}
void showLastAction();
chrome.storage.onChanged.addListener((changes) => {
  if (changes.lastAction) void showLastAction();
});
async function listHighlights() {
  const host = $("highlights");
  host.replaceChildren();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https?:/.test(tab.url)) {
      host.textContent = "Open an article to manage its highlights.";
      return;
    }
    const r = await chrome.runtime.sendMessage({ type: "list", url: tab.url });
    if (r.error) throw Error(r.error);
    if (!r.clips?.length) {
      host.textContent = "No saved highlights on this page.";
      return;
    }
    for (const c of r.clips) {
      const row = document.createElement("div");
      row.className = "highlight-row";
      const quote = document.createElement("p");
      quote.textContent = c.anchor.exact;
      const button = document.createElement("button");
      button.textContent = "Delete highlight";
      button.onclick = async () => {
        if (!confirm("Delete this highlight and its dashboard clipping? Existing Obsidian notes and Zotero references will be kept.")) return;
        button.disabled = true;
        try {
          await send({ type: "delete", id: c.id, url: tab.url, tabId: tab.id });
          $("status").textContent = "Highlight and clipping deleted.";
          await listHighlights();
        } catch (e) {
          $("status").textContent = "Could not delete: " + e.message;
          button.disabled = false;
        }
      };
      row.append(quote, button);
      host.append(row);
    }
  } catch (e) {
    host.textContent = e.message;
  }
}
void listHighlights();
