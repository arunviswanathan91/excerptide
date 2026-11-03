var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// obsidian/main.js
var main_exports = {};
__export(main_exports, {
  default: () => Excerptide
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// shared/client.js
var defaults = { url: "https://iskuiqwevqdnulksmgbc.supabase.co", key: "sb_publishable_3tquoCaNWqWwedtMUYTe8w_xrNl034Z" };
function highlightLink(c) {
  const u = new URL(c.original_url);
  u.hash = `excerptide=${c.id}`;
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
  constructor(read, write, request = (...args) => globalThis.fetch(...args)) {
    this.read = read;
    this.write = write;
    this.request = request;
  }
  async raw(path, init = {}) {
    const s = await this.read();
    const url2 = s.url || defaults.url;
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(url2)) throw Error("Use an HTTPS Supabase project URL without a trailing slash");
    const r = await this.request(url2 + path, { signal: AbortSignal.timeout(2e4), ...init, headers: { apikey: s.key || defaults.key, "Content-Type": "application/json", ...init.headers } });
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

// shared/table.js
function tableGrid(t) {
  const grid = [];
  t.rows.forEach((row, r) => {
    var _a;
    grid[r] ?? (grid[r] = []);
    let c = 0;
    for (const cell of row) {
      while (grid[r][c] !== void 0) c++;
      for (let i = 0; i < (cell.rs || 1); i++) for (let j = 0; j < (cell.cs || 1); j++) {
        grid[_a = r + i] ?? (grid[_a] = []);
        grid[r + i][c + j] = i === 0 && j === 0 ? cell.t : "";
      }
      c += cell.cs || 1;
    }
  });
  const width = Math.max(0, ...grid.map((r) => r.length));
  return grid.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
}

// shared/markdown.js
function escape(v = "") {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_[\]#])/g, "\\$1");
}
function url(v) {
  try {
    const u = new URL(v);
    return ["https:", "http:", "zotero:"].includes(u.protocol) ? u.href.replace(/[<>\s()]/g, (c) => encodeURIComponent(c)) : "";
  } catch {
    return "";
  }
}
function mdTable(t) {
  const g = tableGrid(t);
  if (!g.length || !g[0].length) return "";
  const row = (r) => "| " + r.map((x) => escape(x).replace(/\|/g, "\\|")).join(" | ") + " |";
  return (t.caption ? "**" + escape(t.caption) + "**\n\n" : "") + [row(g[0]), "| " + g[0].map(() => "---").join(" | ") + " |", ...g.slice(1).map(row)].join("\n");
}
function excerpt(c) {
  const t = c.anchor.table && Array.isArray(c.anchor.table.rows) ? mdTable(c.anchor.table) : "";
  return t || "> " + escape(c.anchor.exact).replace(/\n/g, "\n> ");
}
function markdown(c, link) {
  return `<!-- excerptide:start -->
# ${escape(c.title)}

${excerpt(c)}

[Go to highlight](<${url(link)}>) \xB7 [Original source](<${url(c.original_url)}>)

Saved: ${escape(c.created_at)}

${c.doi ? "DOI: " + escape(c.doi) + "\n\n" : ""}${c.pmid ? "PMID: " + escape(c.pmid) + "\n\n" : ""}${c.pmcid ? "PMCID: " + escape(c.pmcid) + "\n\n" : ""}${c.zotero?.url ? "[Open in Zotero](<" + url(c.zotero.url) + ">)\n\n" : ""}${c.tags?.length ? "Tags: " + c.tags.map(escape).join(", ") + "\n\n" : ""}${c.notes ? "Clipping note: " + escape(c.notes) + "\n\n" : ""}<!-- excerptide:end -->`;
}
function noteBody(c, link) {
  return markdown(c, link).replace(/^<!-- excerptide:start -->\n# [^\n]*\n\n/, "").replace(/\n<!-- excerptide:end -->$/, "");
}
function noteName(title) {
  let name = String(title || "Untitled clipping").replace(/[\\/:*?"<>|\[\]#^\r\n]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name += " paper";
  return (name || "Untitled clipping").slice(0, 160).trim();
}

// obsidian/main.js
async function transport(url2, init = {}) {
  const r = await (0, import_obsidian.requestUrl)({ url: url2, method: init.method || "GET", headers: init.headers, body: init.body, throw: false });
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json, text: async () => r.text };
}
var Excerptide = class extends import_obsidian.Plugin {
  async onload() {
    this.settings = { ...defaults, folder: "Excerptide", ...await this.loadData() };
    this.client = new Client(async () => this.settings, async (s) => {
      this.settings = s;
      await this.saveData(s);
    }, transport);
    this.addSettingTab(new Settings(this.app, this));
    this.addCommand({ id: "sync", name: "Sync clippings", callback: () => this.sync() });
    this.addRibbonIcon("highlighter", "Sync Excerptide clippings", () => this.sync());
    this.registerInterval(window.setInterval(() => {
      if (this.settings.session) void this.sync(false);
    }, 6e4));
  }
  async sync(notify = true) {
    var _a, _b;
    if (this.syncing) return;
    this.syncing = true;
    try {
      const clips = await this.client.list();
      const base = this.settings.folder || "Excerptide";
      if (base.split(/[\\/]/).some((x) => x === "..") || base.startsWith("/")) throw Error("Choose a relative vault folder");
      const folder = (0, import_obsidian.normalizePath)(base), owner = this.settings.session.user.id;
      let path = "";
      for (const part of folder.split("/")) {
        path = path ? path + "/" + part : part;
        if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path);
      }
      (_a = this.settings).noteIndex ?? (_a.noteIndex = {});
      const indexKey = (this.settings.url || defaults.url) + "|" + owner;
      const index = (_b = this.settings.noteIndex)[indexKey] ?? (_b[indexKey] = {});
      let count = 0, skipped = 0;
      for (const c of clips) {
        const previous = index[c.id];
        const legacy = (0, import_obsidian.normalizePath)(folder + "/" + owner + "/" + c.id + ".md");
        let existing = previous ? this.app.vault.getAbstractFileByPath(previous.path) : null;
        if (!existing) existing = this.app.vault.getAbstractFileByPath(legacy);
        const content = noteBody(c, highlightLink(c));
        let next = content + "\n\n## My notes\n\n";
        if (existing) {
          const old = await this.app.vault.read(existing);
          const start = "<!-- excerptide:start -->", end = "<!-- excerptide:end -->";
          const a = old.indexOf(start), b = old.indexOf(end);
          if (a >= 0 && b > a) next = old.slice(0, a) + content + old.slice(b + end.length);
          else if (previous?.content && old.startsWith(previous.content)) next = content + old.slice(previous.content.length);
          else {
            skipped++;
            continue;
          }
        }
        const stem = noteName(c.title);
        let target = (0, import_obsidian.normalizePath)(folder + "/" + stem + ".md"), number = 2;
        while (this.app.vault.getAbstractFileByPath(target) && this.app.vault.getAbstractFileByPath(target)?.path !== existing?.path) target = (0, import_obsidian.normalizePath)(folder + "/" + stem + " (" + number++ + ").md");
        if (existing) {
          if (await this.app.vault.read(existing) !== next) await this.app.vault.modify(existing, next);
          if (existing.path !== target) await this.app.fileManager.renameFile(existing, target);
        } else await this.app.vault.create(target, next);
        index[c.id] = { path: target, content };
        await this.saveData(this.settings);
        count++;
      }
      const oldFolder = this.app.vault.getAbstractFileByPath((0, import_obsidian.normalizePath)(folder + "/" + owner));
      if (oldFolder && Array.isArray(oldFolder.children) && oldFolder.children.length === 0) await this.app.vault.delete(oldFolder);
      if (notify) new import_obsidian.Notice(`Excerptide: ${count} clippings synced.${skipped ? " " + skipped + " locally edited notes preserved without overwriting." : " Your notes were preserved."}`);
    } catch (e) {
      if (notify || e.code === "session_expired") new import_obsidian.Notice(e.message);
      console.warn("Excerptide sync failed");
    } finally {
      this.syncing = false;
    }
  }
};
var Settings = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const p = this.plugin;
    const { containerEl: el } = this;
    el.empty();
    el.createEl("h2", { text: "Excerptide Sync" });
    if (p.settings.expired && !p.settings.session) el.createEl("p", { text: "Your sign-in expired. Sign in again below; nothing is lost." });
    el.createEl("p", { text: "Sign in using your dashboard account. Sync imports clippings every minute while Obsidian is open. Paper titles are used as filenames. Write below \u201CMy notes\u201D; if you edit the imported excerpt itself, sync preserves that file rather than overwriting it. Local notes are never deleted by sync." });
    el.createEl("p", { text: "Session tokens are stored in this plugin\u2019s local data.json. Do not publish or share that file. Use a publishable Supabase key only." });
    for (const [key, label] of [["url", "Supabase URL (advanced)"], ["key", "Publishable key (advanced)"], ["folder", "Vault folder"]]) new import_obsidian.Setting(el).setName(label).addText((t) => {
      const builtIn = key !== "folder" && p.settings[key] === defaults[key];
      if (key === "key") t.inputEl.type = "password";
      if (key !== "folder") t.setPlaceholder("Built-in connection (leave blank)");
      t.setValue(builtIn ? "" : p.settings[key]).onChange(async (v) => {
        const next = v.trim() || (key === "folder" ? "" : defaults[key]);
        if (key !== "folder" && next !== p.settings[key]) delete p.settings.session;
        p.settings[key] = next;
        await p.saveData(p.settings);
      });
    });
    let email = "", password = "";
    new import_obsidian.Setting(el).setName("Email").addText((t) => {
      t.inputEl.type = "email";
      t.setPlaceholder("Dashboard email").onChange((v) => email = v);
    });
    new import_obsidian.Setting(el).setName("Password").addText((t) => {
      t.inputEl.type = "password";
      t.onChange((v) => password = v);
    });
    new import_obsidian.Setting(el).setName(p.settings.session ? "Signed in" : "Sign in").addButton((b) => b.setButtonText("Sign in").onClick(async () => {
      try {
        await p.client.login(email, password);
        password = "";
        this.display();
        new import_obsidian.Notice("Excerptide signed in");
      } catch (e) {
        new import_obsidian.Notice(e.message);
      }
    })).addButton((b) => b.setButtonText("Sign out").onClick(async () => {
      try {
        await p.client.logout();
        this.display();
      } catch (e) {
        new import_obsidian.Notice(e.message);
      }
    }));
    new import_obsidian.Setting(el).setName("Sync").addButton((b) => b.setButtonText("Sync now").onClick(() => p.sync()));
  }
};
