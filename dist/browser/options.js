// shared/client.js
var defaults = { url: "https://iskuiqwevqdnulksmgbc.supabase.co", key: "sb_publishable_3tquoCaNWqWwedtMUYTe8w_xrNl034Z" };

// browser/options.js
var ids = ["url", "key", "zoteroUser", "zoteroKey"];
var s = (await chrome.storage.local.get("settings")).settings || {};
for (const id of ids) document.getElementById(id).value = s[id] || defaults[id] || "";
document.getElementById("settings").onsubmit = async (e) => {
  e.preventDefault();
  const next = { ...(await chrome.storage.local.get("settings")).settings };
  for (const id of ids) next[id] = document.getElementById(id).value.trim();
  next.url = next.url.replace(/\/$/, "");
  if (next.key.startsWith("sb_secret_")) {
    document.getElementById("status").textContent = "Use a publishable key, never a secret key.";
    return;
  }
  if (next.url !== s.url || next.key !== s.key) delete next.session;
  await chrome.storage.local.set({ settings: next });
  document.getElementById("status").textContent = "Saved. Sign in again if you changed the connection.";
};
