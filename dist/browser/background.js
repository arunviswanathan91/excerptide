// shared/client.js
var defaults = { url: "https://iskuiqwevqdnulksmgbc.supabase.co", key: "sb_publishable_3tquoCaNWqWwedtMUYTe8w_xrNl034Z" };
function pageKey(url) {
  const u = new URL(url);
  u.hash = "";
  return u.href;
}
var SessionExpiredError = class extends Error {
  constructor() {
    super("Your Excerptide sign-in has expired. Open Excerptide and sign in again; your queued clippings are kept.");
    this.code = "session_expired";
  }
};
var dead = (e) => [400, 401, 403].includes(e?.status) && /refresh_token_not_found|refresh_token_already_used|session_not_found|session_expired|invalid_grant|Invalid Refresh Token/i.test(e.body || "");
var Client = class {
  constructor(read2, write2, request = (...args) => globalThis.fetch(...args)) {
    this.read = read2;
    this.write = write2;
    this.request = request;
  }
  async raw(path, init = {}) {
    const s = await this.read();
    const url = s.url || defaults.url;
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(url)) throw Error("Use an HTTPS Supabase project URL without a trailing slash");
    const r = await this.request(url + path, { signal: AbortSignal.timeout(2e4), ...init, headers: { apikey: s.key || defaults.key, "Content-Type": "application/json", ...init.headers } });
    if (!r.ok) {
      const body = (await r.text()).slice(0, 250);
      const e = Error(`Request failed (${r.status}): ${body}`);
      e.status = r.status;
      e.body = body;
      throw e;
    }
    return r.status === 204 ? null : r.json();
  }
  async login(email, password) {
    const session = await this.raw("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
    const { expired, ...rest } = await this.read();
    await this.write({ ...rest, session: { ...session, expires_at: Date.now() / 1e3 + session.expires_in } });
  }
  async token() {
    const s = await this.read();
    if (!s.session) throw s.expired ? new SessionExpiredError() : Error("Sign in to Excerptide first");
    if (s.session.expires_at > Date.now() / 1e3 + 60) return s.session.access_token;
    if (!this.refreshing) this.refreshing = this.renew(s.session).finally(() => this.refreshing = null);
    return this.refreshing;
  }
  async renew(old) {
    try {
      const v = await this.raw("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: old.refresh_token }) });
      await this.write({ ...await this.read(), session: { ...v, expires_at: Date.now() / 1e3 + v.expires_in } });
      return v.access_token;
    } catch (e) {
      if (!dead(e)) throw e;
      const now = await this.read(), cur = now.session;
      if (cur && cur.refresh_token !== old.refresh_token && cur.expires_at > Date.now() / 1e3 + 60) return cur.access_token;
      if (cur && cur.refresh_token === old.refresh_token) {
        const { session, ...rest } = now;
        await this.write({ ...rest, expired: { userId: session.user?.id, email: session.user?.email, at: Date.now() } });
      }
      throw new SessionExpiredError();
    }
  }
  async api(query = "", init = {}) {
    return this.raw("/rest/v1/clippings" + query, { ...init, headers: { Authorization: "Bearer " + await this.token(), Prefer: "return=representation", ...init.headers } });
  }
  async list(page) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const batch = await this.api("?select=*&order=created_at.asc,id.asc&limit=500&offset=" + offset + (page ? "&page_key=eq." + encodeURIComponent(page) : ""));
      rows.push(...batch);
      if (batch.length < 500) return rows;
    }
  }
  async save(c) {
    await this.token();
    const s = await this.read();
    if (c.user_id && c.user_id !== s.session.user.id) throw Error("Account changed; queued clipping retained for its owner");
    return this.api("?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ ...c, user_id: s.session.user.id }) });
  }
  async update(id, data) {
    return this.api("?id=eq." + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(data) });
  }
  async logout() {
    try {
      const s = await this.read();
      if (s.session && s.session.expires_at > Date.now() / 1e3 + 60) await this.raw("/auth/v1/logout?scope=local", { method: "POST", headers: { Authorization: "Bearer " + s.session.access_token } });
    } catch {
    } finally {
      const s = await this.read();
      delete s.session;
      delete s.expired;
      await this.write(s);
    }
  }
};
function normalizeDoi(v = "") {
  return v.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").toLowerCase();
}
function matchesPaper(c, d) {
  const extra = d.extra || "";
  return Boolean(c.doi && normalizeDoi(c.doi) === normalizeDoi(d.DOI) || c.pmid && new RegExp("(?:^|\\n)PMID:\\s*" + c.pmid + "\\s*(?:$|\\n)", "i").test(extra) || c.pmcid && new RegExp("(?:^|\\n)PMCID:\\s*" + c.pmcid + "\\s*(?:$|\\n)", "i").test(extra));
}
async function zoteroMatch(c, settings) {
  if (!settings.zoteroUser || !settings.zoteroKey) return null;
  if (!/^\d+$/.test(settings.zoteroUser)) throw Error("Zotero user ID must be numeric");
  const matches = /* @__PURE__ */ new Map();
  for (const q of [c.doi, c.pmid, c.pmcid].filter(Boolean)) {
    for (let start = 0; ; start += 100) {
      const r = await fetch(`https://api.zotero.org/users/${settings.zoteroUser}/items/top?format=json&qmode=everything&q=${encodeURIComponent(q)}&limit=100&start=${start}`, { signal: AbortSignal.timeout(15e3), headers: { "Zotero-API-Key": settings.zoteroKey, "Zotero-API-Version": "3" } });
      if (!r.ok) throw Error("Zotero lookup failed: " + r.status);
      const items = await r.json();
      for (const item2 of items) if (matchesPaper(c, item2.data)) matches.set(item2.key, item2);
      if (items.length < 100) break;
    }
  }
  if (matches.size !== 1) return { status: matches.size ? "ambiguous" : "unmatched" };
  const item = [...matches.values()][0];
  return { status: "matched", key: item.key, user: settings.zoteroUser, title: item.data.title, authors: (item.data.creators || []).filter((x) => x.creatorType === "author").map((x) => x.lastName || x.name || x.firstName).filter(Boolean), url: `zotero://select/library/items/${item.key}` };
}

// browser/background.js
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
var read = async () => (await chrome.storage.local.get("settings")).settings || {};
var write = (settings) => chrome.storage.local.set({ settings });
var client = new Client(read, write);
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "highlight", title: "Highlight with Excerptide", contexts: ["selection"] });
  chrome.alarms.create("sync", { periodInMinutes: 1 });
});
async function status(message, error = false) {
  await chrome.storage.local.set({ lastAction: { message, error, at: Date.now() } });
  await chrome.action.setBadgeText({ text: error ? "!" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "highlight" || !tab?.id) return;
  void (async () => {
    try {
      if (info.frameId) throw Error("Open this article in its own tab; embedded frames are not supported.");
      try {
        const ping = await chrome.tabs.sendMessage(tab.id, { type: "ping" });
        if (!ping?.ok) throw Error("No active content script");
      } catch {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      }
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["highlights.css"] });
      const result = await chrome.tabs.sendMessage(tab.id, { type: "capture" });
      if (result?.error) throw Error(result.error);
      if (!result?.ok) throw Error("Refresh this article tab, then select the passage again.");
    } catch (e) {
      await status(e.message + " \u2014 open Excerptide for details.", true);
    }
  })();
});
var serial = Promise.resolve();
function locked(fn) {
  const p = serial.then(fn);
  serial = p.catch(() => {
  });
  return p;
}
async function sync() {
  const s = await read();
  if (!s.session) return;
  const key = "queue:" + s.session.user.id;
  let queue = (await chrome.storage.local.get(key))[key] || [];
  for (const c of [...queue]) {
    try {
      await client.save(c);
      queue = queue.filter((x) => x.id !== c.id);
      await chrome.storage.local.set({ [key]: queue });
      await status("Clipping saved to Supabase. Refresh the dashboard or sync Obsidian.");
    } catch (e) {
      await status(e.code === "session_expired" ? e.message + " " + queue.length + " clipping(s) are saved on this computer." : "Clipping is queued locally. Sync failed: " + e.message, true);
      break;
    }
    if (s.zoteroUser && s.zoteroKey) {
      try {
        const z = await zoteroMatch(c, s);
        if (z) {
          await client.update(c.id, { zotero: z });
          await status(z.status === "matched" ? "Clipping saved and linked to Zotero." : z.status === "ambiguous" ? "Clipping saved; multiple Zotero items match." : "Clipping saved; no exact identifier match in the online Zotero library.");
        }
      } catch (e) {
        await status("Clipping saved; Zotero linking failed: " + e.message, true);
      }
    }
  }
}
chrome.alarms.onAlarm.addListener(() => locked(sync));
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  (async () => {
    const trusted = sender.url?.startsWith(chrome.runtime.getURL(""));
    if (m.type === "login" && trusted) {
      await locked(() => client.login(m.email, m.password));
      await status("Signed in.");
      void locked(sync);
      return { ok: true };
    }
    if (m.type === "logout" && trusted) {
      await locked(() => client.logout());
      return { ok: true };
    }
    if (m.type === "sync" && trusted) {
      await locked(sync);
      return { ok: true };
    }
    if (m.type === "list") {
      const url = (sender.tab ? sender.url : null) || m.url;
      if (!url) throw Error("No webpage");
      const s = await read();
      const uid = s.session?.user.id ?? s.expired?.userId;
      if (!uid) return { clips: [] };
      const p = pageKey(url);
      const queue = (await chrome.storage.local.get("queue:" + uid))["queue:" + uid] || [];
      let clips = [];
      try {
        clips = await client.list(p);
        await chrome.storage.local.set({ ["cache:" + uid + ":" + p]: clips });
      } catch (e) {
        clips = (await chrome.storage.local.get("cache:" + uid + ":" + p))["cache:" + uid + ":" + p] || [];
      }
      return { clips: [...new Map([...clips, ...queue.filter((c) => c.page_key === p)].map((c) => [c.id, c])).values()] };
    }
    if (m.type === "save" && sender.tab) {
      return locked(async () => {
        const s = await read();
        const uid = s.session?.user.id ?? s.expired?.userId;
        if (!uid) throw Error("Open Excerptide and sign in first");
        const c = m.clip;
        if (!c?.anchor?.exact || c.anchor.exact.length > 1e5) throw Error("Invalid or excessively long selection");
        if (pageKey(c.original_url) !== pageKey(sender.url)) throw Error("Page changed; select the passage again");
        c.id = crypto.randomUUID();
        c.page_key = pageKey(c.original_url);
        c.created_at = (/* @__PURE__ */ new Date()).toISOString();
        c.user_id = uid;
        const key = "queue:" + uid;
        const q = (await chrome.storage.local.get(key))[key] || [];
        q.push(c);
        await chrome.storage.local.set({ [key]: q });
        await status(s.session ? "Highlight queued locally; syncing\u2026" : "Highlight saved on this computer. Your sign-in expired: open Excerptide and sign in again to sync it.", !s.session);
        void locked(sync);
        return { clip: c, pending: true };
      });
    }
    if (m.type === "delete" && (trusted || sender.tab)) {
      return locked(async () => {
        if (!/^[0-9a-f-]{36}$/i.test(m.id || "")) throw Error("Invalid clipping ID");
        const s = await read();
        if (!s.session) throw Error(s.expired ? "Your sign-in expired. Open Excerptide and sign in again to delete this highlight." : "Sign in to delete this highlight");
        const page = pageKey(sender.tab ? sender.url : m.url);
        const key = "queue:" + s.session.user.id;
        await client.api("?id=eq." + encodeURIComponent(m.id) + "&page_key=eq." + encodeURIComponent(page), { method: "DELETE" });
        const queue = (await chrome.storage.local.get(key))[key] || [];
        await chrome.storage.local.set({ [key]: queue.filter((c) => !(c.id === m.id && c.page_key === page)) });
        const cacheKey = "cache:" + s.session.user.id + ":" + page;
        const cache = (await chrome.storage.local.get(cacheKey))[cacheKey] || [];
        await chrome.storage.local.set({ [cacheKey]: cache.filter((c) => c.id !== m.id) });
        await status("Highlight and saved clipping deleted.");
        const tabId = sender.tab?.id || (trusted ? m.tabId : null);
        if (tabId) await chrome.tabs.sendMessage(tabId, { type: "refresh" }).catch(() => {
        });
        return { ok: true };
      });
    }
    if (m.type === "note" && (trusted || sender.tab)) {
      return locked(async () => {
        if (!/^[0-9a-f-]{36}$/i.test(m.id || "")) throw Error("Invalid clipping ID");
        if (typeof m.notes !== "string" || m.notes.length > 1e4) throw Error("Note must be text under 10,000 characters");
        const s = await read();
        if (!s.session) throw Error(s.expired ? "Your sign-in expired. Open Excerptide and sign in again to save this note." : "Sign in to save a note");
        const key = "queue:" + s.session.user.id;
        const queue = (await chrome.storage.local.get(key))[key] || [];
        const queued = queue.some((c) => c.id === m.id);
        if (queued) await chrome.storage.local.set({ [key]: queue.map((c) => c.id === m.id ? { ...c, notes: m.notes } : c) });
        else await client.update(m.id, { notes: m.notes });
        const all = await chrome.storage.local.get(null);
        const patch = {};
        for (const [k, v] of Object.entries(all)) if (k.startsWith("cache:" + s.session.user.id + ":") && Array.isArray(v)) patch[k] = v.map((c) => c.id === m.id ? { ...c, notes: m.notes } : c);
        if (Object.keys(patch).length) await chrome.storage.local.set(patch);
        await status(queued ? "Note saved locally; it will sync with the highlight." : "Note saved to your dashboard.");
        return { ok: true };
      });
    }
    if (m.type === "zotero" && trusted) {
      const clips = await client.list(m.page);
      let count = 0;
      for (const c of clips) {
        const z = await zoteroMatch(c, await read());
        if (z) {
          await client.update(c.id, { zotero: z });
          if (z.status === "matched") count++;
        }
      }
      return { count };
    }
    throw Error("Unsupported action");
  })().then(respond).catch((e) => respond({ error: e.message }));
  return true;
});
