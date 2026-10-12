// shared/client.js
var defaults = { url: "https://iskuiqwevqdnulksmgbc.supabase.co", key: "sb_publishable_3tquoCaNWqWwedtMUYTe8w_xrNl034Z" };
function pageKey(url) {
  const u = new URL(url);
  u.hash = "";
  return u.href;
}
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
    const r = await this.request(url + path, { ...init, headers: { apikey: s.key || defaults.key, "Content-Type": "application/json", ...init.headers } });
    if (!r.ok) throw Error(`Request failed (${r.status}): ${(await r.text()).slice(0, 250)}`);
    return r.status === 204 ? null : r.json();
  }
  async login(email, password) {
    const session = await this.raw("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
    await this.write({ ...await this.read(), session: { ...session, expires_at: Date.now() / 1e3 + session.expires_in } });
  }
  async token() {
    const s = await this.read();
    if (!s.session) throw Error("Sign in to Excerptide first");
    if (s.session.expires_at > Date.now() / 1e3 + 60) return s.session.access_token;
    if (!this.refreshing) this.refreshing = (async () => {
      const v = await this.raw("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: s.session.refresh_token }) });
      await this.write({ ...await this.read(), session: { ...v, expires_at: Date.now() / 1e3 + v.expires_in } });
      return v.access_token;
    })().finally(() => this.refreshing = null);
    return this.refreshing;
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
      await this.raw("/auth/v1/logout", { method: "POST", headers: { Authorization: "Bearer " + await this.token() } });
    } finally {
      const s = await this.read();
      delete s.session;
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
      const r = await fetch(`https://api.zotero.org/users/${settings.zoteroUser}/items/top?format=json&qmode=everything&q=${encodeURIComponent(q)}&limit=100&start=${start}`, { headers: { "Zotero-API-Key": settings.zoteroKey, "Zotero-API-Version": "3" } });
      if (!r.ok) throw Error("Zotero lookup failed: " + r.status);
      const items = await r.json();
      for (const item2 of items) if (matchesPaper(c, item2.data)) matches.set(item2.key, item2);
      if (items.length < 100) break;
    }
  }
  if (matches.size !== 1) return { status: matches.size ? "ambiguous" : "unmatched" };
  const item = [...matches.values()][0];
  return { status: "matched", key: item.key, user: settings.zoteroUser, title: item.data.title, url: `zotero://select/library/items/${item.key}` };
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
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "highlight" && tab?.id) chrome.tabs.sendMessage(tab.id, { type: "capture" }).catch(() => {
  });
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
    } catch {
      break;
    }
  }
}
chrome.alarms.onAlarm.addListener(() => locked(sync));
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  (async () => {
    const trusted = sender.url?.startsWith(chrome.runtime.getURL(""));
    if (m.type === "login" && trusted) {
      await locked(() => client.login(m.email, m.password));
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
      if (!s.session) return { clips: [] };
      const p = pageKey(url);
      const queue = (await chrome.storage.local.get("queue:" + s.session.user.id))["queue:" + s.session.user.id] || [];
      let clips = [];
      try {
        clips = await client.list(p);
        await chrome.storage.local.set({ ["cache:" + s.session.user.id + ":" + p]: clips });
      } catch (e) {
        clips = (await chrome.storage.local.get("cache:" + s.session.user.id + ":" + p))["cache:" + s.session.user.id + ":" + p] || [];
      }
      return { clips: [...new Map([...clips, ...queue.filter((c) => c.page_key === p)].map((c) => [c.id, c])).values()] };
    }
    if (m.type === "save" && sender.tab) {
      return locked(async () => {
        const s = await read();
        if (!s.session) throw Error("Open Excerptide and sign in first");
        const c = m.clip;
        if (!c?.anchor?.exact || c.anchor.exact.length > 1e5) throw Error("Invalid or excessively long selection");
        if (pageKey(c.original_url) !== pageKey(sender.url)) throw Error("Page changed; select the passage again");
        c.id = crypto.randomUUID();
        c.page_key = pageKey(c.original_url);
        c.created_at = (/* @__PURE__ */ new Date()).toISOString();
        c.user_id = s.session.user.id;
        const key = "queue:" + s.session.user.id;
        const q = (await chrome.storage.local.get(key))[key] || [];
        q.push(c);
        await chrome.storage.local.set({ [key]: q });
        await sync();
        const remaining = (await chrome.storage.local.get(key))[key] || [];
        return { clip: c, pending: remaining.some((x) => x.id === c.id) };
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
