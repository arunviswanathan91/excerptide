(() => {
  // shared/anchor.js
  var reject = 'script,style,noscript,textarea,input,select,[contenteditable="true"],[data-excerptide-ui]';
  function indexText(doc) {
    const nodes = [];
    let text = "";
    const walker = doc.createTreeWalker(doc.body, 4, { acceptNode: (n) => n.parentElement?.closest(reject) ? 2 : 1 });
    while (walker.nextNode()) {
      const n = walker.currentNode;
      nodes.push({ node: n, start: text.length, end: text.length + n.textContent.length });
      text += n.textContent;
    }
    return { text, nodes };
  }
  function path(node) {
    const p = [];
    while (node?.parentNode) {
      p.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node));
      node = node.parentNode;
    }
    return p;
  }
  function capture(range, doc) {
    const { text, nodes } = indexText(doc);
    function offset(container, at) {
      const boundary = doc.createRange();
      boundary.setStart(container, at);
      boundary.collapse(true);
      let total = 0;
      for (const entry of nodes) {
        const n = entry.node;
        if (n === container) return entry.start + at;
        const nr = doc.createRange();
        nr.selectNodeContents(n);
        if (nr.compareBoundaryPoints(2, boundary) <= 0) total = entry.end;
        else break;
      }
      return total;
    }
    const start = offset(range.startContainer, range.startOffset), end = offset(range.endContainer, range.endOffset);
    const exact = text.slice(start, end);
    if (!exact.trim() || exact !== range.toString()) throw Error("Please select a continuous passage of article text");
    return { exact, prefix: text.slice(Math.max(0, start - 64), start), suffix: text.slice(end, end + 64), start, end, dom: { start: path(range.startContainer), startOffset: range.startOffset, end: path(range.endContainer), endOffset: range.endOffset } };
  }
  function locate(a, text) {
    if (text.slice(a.start, a.end) === a.exact && (!a.prefix || text.slice(Math.max(0, a.start - a.prefix.length), a.start) === a.prefix) && (!a.suffix || text.slice(a.end, a.end + a.suffix.length) === a.suffix)) return a.start;
    const candidates = [];
    let pos = -1;
    while ((pos = text.indexOf(a.exact, pos + 1)) !== -1) {
      let score = 0;
      if (a.prefix && text.slice(Math.max(0, pos - a.prefix.length), pos) === a.prefix) score++;
      if (a.suffix && text.slice(pos + a.exact.length, pos + a.exact.length + a.suffix.length) === a.suffix) score++;
      candidates.push({ pos, score });
    }
    candidates.sort((a2, b) => b.score - a2.score);
    if (!candidates.length || candidates.length > 1 && candidates[0].score === candidates[1].score) return null;
    return candidates[0].pos;
  }
  function restore(a, doc) {
    const { text, nodes } = indexText(doc);
    const start = locate(a, text);
    if (start === null) return null;
    const end = start + a.exact.length;
    const first = nodes.find((n) => n.end > start), last = nodes.find((n) => n.end >= end);
    if (!first || !last) return null;
    const r = doc.createRange();
    r.setStart(first.node, start - first.start);
    r.setEnd(last.node, end - last.start);
    return r;
  }

  // browser/content.js
  var clips = [];
  var timer;
  var selectionRange;
  var style = document.createElement("style");
  style.textContent = "::highlight(excerptide){background:#ffe58a;color:#171717}";
  document.head.append(style);
  function notice(text) {
    const el = document.createElement("div");
    el.dataset.excerptideUi = "true";
    el.textContent = text;
    Object.assign(el.style, { position: "fixed", bottom: "24px", right: "24px", background: "#172e31", color: "white", padding: "14px 20px", zIndex: "2147483647", borderRadius: "12px", font: "14px system-ui", maxWidth: "360px" });
    document.body.append(el);
    setTimeout(() => el.remove(), 5e3);
  }
  function paint(scroll = false) {
    if (!globalThis.Highlight || !CSS.highlights) return;
    const ranges = [];
    const target = new URLSearchParams(location.hash.slice(1)).get("excerptide");
    for (const c of clips) {
      const r = restore(c.anchor, document);
      if (r) {
        ranges.push(r);
        if (scroll && c.id === target) r.startContainer.parentElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    CSS.highlights.set("excerptide", new Highlight(...ranges));
  }
  async function load() {
    try {
      const r = await chrome.runtime.sendMessage({ type: "list" });
      if (r.clips) {
        clips = r.clips;
        paint(true);
      }
    } catch {
    }
  }
  function meta(...names) {
    for (const name of names) {
      const el = document.querySelector(`meta[name="${name}"],meta[property="${name}"]`);
      if (el?.content) return el.content;
    }
    return null;
  }
  async function save() {
    try {
      const sel = getSelection();
      const range = sel?.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : selectionRange;
      if (!range) throw Error("Select a passage first");
      const anchor = capture(range, document);
      const original_url = location.href;
      const pmid = meta("citation_pmid") || (location.hostname === "pubmed.ncbi.nlm.nih.gov" ? location.pathname.match(/^\/(\d+)/)?.[1] : null);
      const pmcid = meta("citation_pmcid") || location.pathname.match(/\bPMC\d+\b/)?.[0] || null;
      const clip = { original_url, title: meta("citation_title", "og:title") || document.title, anchor, doi: meta("citation_doi", "DC.Identifier.DOI"), pmid, pmcid, notes: "", tags: [], color: "yellow" };
      const r = await chrome.runtime.sendMessage({ type: "save", clip });
      if (r.error) throw Error(r.error);
      clips.push(r.clip);
      paint();
      notice(r.pending ? "Highlighted \u2022 queued locally; will retry syncing" : "Highlighted \u2022 saved to your dashboard");
    } catch (e) {
      notice(e.message);
    }
  }
  document.addEventListener("selectionchange", () => {
    const s = getSelection();
    if (s?.rangeCount && !s.isCollapsed) selectionRange = s.getRangeAt(0).cloneRange();
  });
  chrome.runtime.onMessage.addListener((m) => {
    if (m.type === "capture") void save();
  });
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.code === "KeyH") {
      e.preventDefault();
      void save();
    }
  });
  new MutationObserver((records) => {
    if (records.every((r) => r.target.parentElement?.closest("[data-excerptide-ui]") || r.type === "childList" && [...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType === 1 && n.hasAttribute("data-excerptide-ui")))) return;
    clearTimeout(timer);
    timer = setTimeout(() => paint(), 400);
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
  window.addEventListener("hashchange", () => paint(true));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void load();
  });
  void load();
  setInterval(() => {
    if (!document.hidden) void load();
  }, 6e4);
})();
