// ==UserScript==
// @name         GTU Announcement Dates
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/gtu-announcement-dates.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/gtu-announcement-dates.user.js
// @description  Adds each announcement's last-updated date to the Gebze Technical University announcement lists.
// @author       volkan.cicek
// @match        https://www.gtu.edu.tr/kategori/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = {
    cacheDurationMs: 6 * 60 * 60 * 1000,
    maxAnnouncements: 40,
  };
  const SELECTORS = {
    list: "ul.list-disc",
    announcementLinks: "ul.list-disc li a",
    pageDate: "div.flex.items-center.gap-2.p-4 span",
  };
  const CACHE_KEY_PREFIX = "gtu_date_cache_";
  const DATE_LABEL = "Son güncelleme:";
  const COLORS = {
    cached: "#17a2b8",
    loading: "#ffc107",
    fresh: "#dc3545",
    failed: "#6c757d",
  };

  const log = {
    info: (...args) => console.log("[GTU Announcement Dates]", ...args),
    error: (...args) => console.error("[GTU Announcement Dates]", ...args),
  };

  function readCachedDate(cacheKey) {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    try {
      const cached = JSON.parse(raw);
      return Date.now() - cached.timestamp < CONFIG.cacheDurationMs ? cached.date : null;
    } catch {
      localStorage.removeItem(cacheKey);
      return null;
    }
  }

  function purgeExpired() {
    const now = Date.now();
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(CACHE_KEY_PREFIX)) continue;
      try {
        const cached = JSON.parse(localStorage.getItem(key));
        if (!cached?.timestamp || now - cached.timestamp > CONFIG.cacheDurationMs) localStorage.removeItem(key);
      } catch {
        localStorage.removeItem(key);
      }
    }
  }

  async function fetchPageDate(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Page failed to load");
    const page = new DOMParser().parseFromString(await response.text(), "text/html");
    const dateElement = page.querySelector(SELECTORS.pageDate);
    return dateElement ? dateElement.textContent.trim().replace(DATE_LABEL, "").trim() : null;
  }

  function markNotFetchable(link) {
    const note = document.createElement("span");
    note.textContent = " (PDF/External link)";
    note.style.cssText = "color: #6c757d; font-style: italic; margin-left: 8px;";
    link.after(note);
  }

  async function annotate(link) {
    const dateSpan = document.createElement("span");
    dateSpan.style.cssText = "font-weight: bold; margin-left: 8px;";
    link.after(dateSpan);
    const show = (text, color) => {
      dateSpan.textContent = text;
      dateSpan.style.color = color;
    };

    const cacheKey = `${CACHE_KEY_PREFIX}${link.href}`;
    const cachedDate = readCachedDate(cacheKey);
    if (cachedDate !== null) {
      show(` (Last updated: ${cachedDate})`, COLORS.cached);
      return;
    }

    show(" (Fetching date...)", COLORS.loading);
    try {
      const date = await fetchPageDate(link.href);
      if (date === null) {
        show(" (Date not found)", COLORS.failed);
        return;
      }
      show(` (Last updated: ${date})`, COLORS.fresh);
      localStorage.setItem(cacheKey, JSON.stringify({ date, timestamp: Date.now() }));
    } catch (error) {
      log.error(`Error: could not get the date from ${link.href}.`, error);
      show(" (Error)", COLORS.failed);
    }
  }

  async function processAnnouncements() {
    const links = [...document.querySelectorAll(SELECTORS.announcementLinks)];
    if (links.length === 0 || document.body.dataset.scriptProcessed) return;
    document.body.dataset.scriptProcessed = "true";

    const selected = links.slice(0, CONFIG.maxAnnouncements);
    log.info(`processing ${selected.length} announcements...`);

    for (const link of selected) {
      const isFetchable = !link.href.toLowerCase().endsWith(".pdf") && link.href.startsWith(location.origin);
      if (isFetchable) await annotate(link);
      else markNotFetchable(link);
    }
  }

  purgeExpired();

  // The site is a Next.js app: when hydration finds the server HTML changed (our labels change it), React
  // re-renders the body and drops the labels and the processed marker with it. So the observer stays on for
  // the life of the page and labels the re-rendered list again, mostly from cache. It watches the root
  // because at document-start the body does not exist yet.
  new MutationObserver(() => {
    if (document.querySelector(SELECTORS.list)) processAnnouncements();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
