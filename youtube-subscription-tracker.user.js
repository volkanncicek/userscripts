// ==UserScript==
// @name         YouTube Subscription Tracker
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.20
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/youtube-subscription-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/youtube-subscription-tracker.user.js
// @description  Auto-track which Subscription videos you've opened and resume scanning from where you left off
// @author       volkan.cicek
// @match        https://www.youtube.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// @noframes     true
// ==/UserScript==

(() => {
  "use strict";

  const LOG_PREFIX = "[YouTube Subscription Tracker]";
  const OPENED_KEY = "yt_sub_tracker_opened";
  const UI_CONTAINER_ID = "yt-sub-tracker-ui";
  const SUBSCRIPTIONS_PATH = "/feed/subscriptions";

  const SELECTORS = {
    videoItem: "yt-lockup-view-model",
    watchLink: 'a[href*="/watch?v="]',
    titleLink: 'h3 a[href*="/watch?v="]',
    titleAttribute: "h3 [title]",
    titleHeading: "h3",
    continuationItem: "ytd-continuation-item-renderer",
    spinner: "#spinnerContainer.active, #spinner.ytd-feed-filter-chip-bar-renderer",
    shelfSubscribeButton: "ytd-shelf-renderer #dismissible #title-container #subscribe-button",
    observerRoot: 'ytd-browse[role="main"]',
  };

  const UI_TEXT = {
    RESUME: "Resume",
    CLEAR_PROGRESS: "Clear",
    STATUS_FOUND: "Found!",
    STATUS_CLEARED: "Cleared!",
    STATUS_NOTFOUND: "Not found",
    STATUS_NEAREST: "Last video gone, went to the nearest",
  };

  const TIME_UNITS = [
    { secs: 31_536_000, single: "year", plural: "years" },
    { secs: 2_592_000, single: "month", plural: "months" },
    { secs: 604_800, single: "week", plural: "weeks" },
    { secs: 86_400, single: "day", plural: "days" },
    { secs: 3_600, single: "hour", plural: "hours" },
    { secs: 60, single: "minute", plural: "minutes" },
  ];

  const DURATION_SUFFIX_REGEX = /\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/;

  const CONFIG = {
    maxOpened: 500,
    highlightColor: "rgba(255, 215, 0, 0.4)",
    highlightDurationMs: 5_000,
    debounceMs: 300,
    pageChangeDebounceMs: 1_500,
    maxScrollAttempts: 50,
    // Videos opened in one sitting sit within a few loads of each other, so once this many videos have loaded past the first opened one, the last-opened one is gone from the feed. Counted in videos rather than loads so a second Resume on an already loaded feed does not load more.
    videosPastFirstOpened: 100,
    pollIntervalMs: 100,
    maxPollAttempts: 60,
    statusClearMs: 2_000,
    uiCheckIntervalMs: 1_000,
    statusSuccessColor: "#4ade80", // muted so it sits in YouTube's dark palette
    statusErrorColor: "#f87171", // muted to match the success colour
    resumeButtonColor: "#cc0000", // YouTube's own red, softer than pure red
    clearButtonColor: "#3ea6ff", // YouTube's brand blue
  };

  const STYLES = {
    container: `
      background-color: var(--yt-spec-brand-background-solid, #212121);
      color: var(--yt-spec-text-primary, #fff);
      padding: 6px 8px;
      border-radius: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      font-family: "Roboto", Arial, sans-serif;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    `,
    statusText: `
      font-weight: 500;
      padding: 0 4px;
      color: ${CONFIG.statusSuccessColor};
      min-height: 1.2em;
      display: inline-block;
      transition: color 0.3s ease;
    `,
    buttonRow: "display: inline-flex; gap: 6px;",
    timeIndicator: `
      font-size: 11px;
      color: var(--yt-spec-text-secondary, #aaa);
      padding: 0 4px;
      font-weight: 400;
      min-height: 1.2em;
      display: inline-block;
      opacity: 0.8;
    `,
    button: (bgColor) => `
      background-color: ${bgColor};
      color: #fff;
      border: none;
      border-radius: 18px;
      padding: 7px 14px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s ease, opacity 0.2s ease, filter 0.2s ease;
      white-space: nowrap;
    `,
    inlineAnchor: "position: static !important; margin: 0 8px 0 0 !important;",
    floating: `
      position: fixed !important;
      bottom: 20px !important;
      right: 20px !important;
      z-index: 9999 !important;
      margin: 0 !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
    `,
  };

  const log = {
    info: (...args) => console.log(LOG_PREFIX, ...args),
    warn: (...args) => console.warn(LOG_PREFIX, ...args),
    error: (...args) => console.error(LOG_PREFIX, ...args),
  };

  function debounce(fn, ms) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getScrollHeight() {
    return Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      document.documentElement.clientHeight,
    );
  }

  function isOnSubscriptionsPage() {
    return window.location.pathname === SUBSCRIPTIONS_PATH;
  }

  function extractVideoId(href) {
    return href?.match(/watch\?v=([^&]+)/)?.[1] ?? null;
  }

  function formatTimeAgo(timestamp) {
    if (!timestamp) return null;
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    for (const { secs, single, plural } of TIME_UNITS) {
      const value = Math.floor(seconds / secs);
      if (value > 0) return `${value} ${value === 1 ? single : plural} ago`;
    }
    return "just now";
  }

  function extractTitle(container) {
    const stripDuration = (text) => text.replace(DURATION_SUFFIX_REGEX, "").trim() || text;
    const candidates = [
      () => container.querySelector(SELECTORS.titleLink)?.textContent,
      () => container.querySelector(SELECTORS.titleAttribute)?.getAttribute("title"),
      () => container.querySelector(SELECTORS.titleHeading)?.textContent,
    ];
    for (const readCandidate of candidates) {
      const raw = readCandidate()?.trim();
      if (raw) return stripDuration(raw);
    }
    return "Unknown Video";
  }

  function extractVideoData(container, id) {
    const rect = container.getBoundingClientRect();
    return {
      id,
      title: extractTitle(container),
      element: container,
      position: rect.top + window.scrollY,
    };
  }

  function getAllLoadedVideos() {
    const videoMap = new Map();
    for (const link of document.querySelectorAll(SELECTORS.watchLink)) {
      const id = extractVideoId(link.href || link.getAttribute("href"));
      if (!id || videoMap.has(id)) continue;
      const container = link.closest(SELECTORS.videoItem);
      if (!container) continue;
      videoMap.set(id, extractVideoData(container, id));
    }
    return Array.from(videoMap.values()).sort((a, b) => a.position - b.position);
  }

  function scrollToElement(element) {
    if (!document.body.contains(element)) return;
    try {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      log.warn("scrollIntoView failed:", error);
    }
  }

  function highlightElement(element, color, durationMs) {
    const original = element.style.cssText;
    element.style.transition = "background-color 0.3s ease, box-shadow 0.3s ease, border-radius 0.3s ease";
    element.style.backgroundColor = color;
    element.style.boxShadow = `0 0 15px 5px ${color}`;
    element.style.borderRadius = "8px";
    setTimeout(() => (element.style.cssText = original), durationMs);
  }

  function waitForNewContent() {
    const initialCount = document.querySelectorAll(SELECTORS.watchLink).length;
    const initialHeight = getScrollHeight();
    let attempts = 0;
    return new Promise((resolve) => {
      const check = () => {
        attempts++;
        const count = document.querySelectorAll(SELECTORS.watchLink).length;
        const height = getScrollHeight();
        const hasSpinner = document.querySelectorAll(SELECTORS.spinner).length > 0;

        if (count > initialCount || (height > initialHeight && !hasSpinner && attempts > 3)) return resolve(true);
        if (attempts >= CONFIG.maxPollAttempts) return resolve(false);
        if (hasSpinner || attempts < 10) {
          requestAnimationFrame(() => setTimeout(check, CONFIG.pollIntervalMs));
        } else {
          resolve(false);
        }
      };
      requestAnimationFrame(() => setTimeout(check, CONFIG.pollIntervalMs));
    });
  }

  async function scrollAndLoadMore() {
    const continuation = document.querySelector(SELECTORS.continuationItem);
    if (continuation) {
      continuation.scrollIntoView({ behavior: "auto", block: "nearest" });
      if (await waitForNewContent()) return true;
    }

    const initialY = window.scrollY;
    const viewport = window.innerHeight;
    const docHeight = getScrollHeight();
    const distance = docHeight - (initialY + viewport);

    if (distance < 100) {
      window.scrollTo({ top: docHeight, behavior: "auto" });
      await wait(500);
      const loaded = await waitForNewContent();
      return loaded || Math.abs(window.scrollY - initialY) > 10;
    }

    const step = distance > 5000 ? viewport * 3 : distance > 2000 ? viewport * 2.5 : viewport * 2;
    window.scrollTo({ top: Math.min(initialY + step, docHeight - viewport), behavior: "auto" });
    await wait(600);
    return await waitForNewContent();
  }

  async function waitForInjectionTarget() {
    for (let i = 0; i < CONFIG.maxPollAttempts; i++) {
      if (!isOnSubscriptionsPage()) return null;
      const target = document.querySelector(SELECTORS.shelfSubscribeButton);
      if (target) return target;
      await wait(CONFIG.pollIntervalMs);
    }
    return null;
  }

  function loadOpened() {
    try {
      const raw = GM_getValue(OPENED_KEY);
      if (raw == null) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      log.error("load error:", error);
      return [];
    }
  }

  function saveOpened(data) {
    GM_setValue(OPENED_KEY, JSON.stringify(data));
  }

  class YouTubeTracker {
    constructor() {
      this.opened = loadOpened(); // [{ id, title, timestamp }], most-recent first
      this.active = false;
      this.isSearching = false;
      this.statusTimeout = null;
      this.observer = null;
      this.uiCheckTimer = null;
      this.initializing = false;
      this.ui = null; // { container, statusText, timeIndicator, resumeButton, clearButton }

      this.debouncedHandlePageChange = debounce(this._handlePageChange.bind(this), CONFIG.pageChangeDebounceMs);
      this.debouncedResume = debounce(this._resume.bind(this), CONFIG.debounceMs);

      // Capture clicks on video links (left, ctrl-click), middle-click (auxclick) and right-click (contextmenu), so opening in a new tab via any method, including the right-click "Open in new tab" menu, still counts.
      const onClick = this._onVideoClick.bind(this);
      document.addEventListener("click", onClick, true);
      document.addEventListener("auxclick", onClick, true);
      document.addEventListener("contextmenu", onClick, true);

      // Tampermonkey injects only on a full page load, and YouTube reaches Subscriptions through its own SPA navigation, so the script runs on every YouTube page and switches itself on and off as the app navigates.
      window.addEventListener("yt-navigate-start", () => this._deactivate());
      window.addEventListener("yt-navigate-finish", () => {
        if (isOnSubscriptionsPage()) this._activate();
        else this._deactivate();
      });
      if (isOnSubscriptionsPage()) this._activate();
    }

    // Idempotent, because yt-navigate-finish can also fire for the initial load the constructor already handled.
    _activate() {
      if (this.active) return;
      this.active = true;
      // YouTube can re-render the shelf header after the feed has loaded, taking the UI with it, and the feed observer only reacts to new videos. So a cheap periodic check puts the UI back whenever it is missing.
      this.uiCheckTimer = setInterval(() => this._ensureUI(), CONFIG.uiCheckIntervalMs);
      this._initWhenReady();
    }

    _deactivate() {
      this.active = false;
      clearInterval(this.uiCheckTimer);
      this.uiCheckTimer = null;
      this.observer?.disconnect();
      this.observer = null;
      if (this.ui?.container) this.ui.container.style.display = "none";
    }

    async _initWhenReady() {
      if (!this.active || this.initializing) return;
      this.initializing = true;
      try {
        const target = await waitForInjectionTarget();
        // The user may have navigated away while the target was awaited; injecting now would float the UI over an unrelated page.
        if (!this.active) return;
        if (!target) log.warn("Shelf injection target never appeared, using floating UI");
        this._injectUI(target);
        this._setupObserver();
      } finally {
        this.initializing = false;
      }
    }

    _ensureUI() {
      if (this.isSearching || this.initializing) return;
      const ui = document.getElementById(UI_CONTAINER_ID);
      if (ui?.isConnected && ui.style.display !== "none") return;
      this._initWhenReady();
    }

    _onVideoClick(event) {
      // auxclick fires for any non-primary button; only middle-click (1) opens a new tab.
      // contextmenu (right-click) always counts: the user opens videos via "Open in new tab". Accepted tradeoff: the menu-open fires before any selection, so a right-click dismissed without opening is still recorded.
      if (event.type === "auxclick" && event.button !== 1) return;
      if (!isOnSubscriptionsPage()) return;

      const link = event.target.closest?.(SELECTORS.watchLink);
      if (!link) return;
      const id = extractVideoId(link.href || link.getAttribute("href"));
      if (!id) return;
      const container = link.closest(SELECTORS.videoItem);
      if (!container) return; // ignore clicks outside the subscription feed grid

      this._recordOpened(id, container);
    }

    _recordOpened(id, container) {
      const now = Date.now();
      const title = extractTitle(container);

      this.opened = this.opened.filter((entry) => entry.id !== id);
      this.opened.unshift({ id, title, timestamp: now });
      if (this.opened.length > CONFIG.maxOpened) this.opened.length = CONFIG.maxOpened;

      saveOpened(this.opened);
      log.info(`Marked opened: "${title}" (${id})`);
      this._updateUI();
    }

    _injectUI(subscribeButton) {
      const existing = document.getElementById(UI_CONTAINER_ID);
      if (existing) {
        if (subscribeButton && existing.nextElementSibling !== subscribeButton) {
          existing.remove();
        } else {
          existing.style.display = "";
          this._updateUI();
          return;
        }
      }

      const container = this._buildUI();
      if (subscribeButton) {
        subscribeButton.insertAdjacentElement("beforebegin", container);
        container.style.cssText += STYLES.inlineAnchor;
      } else {
        container.style.cssText += STYLES.floating;
        document.body.appendChild(container);
      }
      this._updateUI();
    }

    _buildUI() {
      const container = document.createElement("div");
      container.id = UI_CONTAINER_ID;
      container.style.cssText = STYLES.container;

      const statusText = document.createElement("div");
      statusText.style.cssText = STYLES.statusText;
      container.appendChild(statusText);

      const buttonRow = document.createElement("div");
      buttonRow.style.cssText = STYLES.buttonRow;
      const resumeButton = this._createButton(UI_TEXT.RESUME, CONFIG.resumeButtonColor, this.debouncedResume);
      const clearButton = this._createButton(
        UI_TEXT.CLEAR_PROGRESS,
        CONFIG.clearButtonColor,
        this._clearProgress.bind(this),
      );
      buttonRow.appendChild(resumeButton);
      buttonRow.appendChild(clearButton);
      container.appendChild(buttonRow);

      const timeIndicator = document.createElement("div");
      timeIndicator.style.cssText = STYLES.timeIndicator;
      container.appendChild(timeIndicator);

      this.ui = { container, statusText, timeIndicator, resumeButton, clearButton };
      return container;
    }

    _createButton(text, bgColor, onClick) {
      const button = document.createElement("button");
      button.textContent = text;
      button.style.cssText = STYLES.button(bgColor);
      button.addEventListener("click", onClick);
      button.onmouseover = () => {
        if (!button.disabled) button.style.filter = "brightness(0.9)";
      };
      button.onmouseout = () => {
        button.style.filter = button.disabled ? "grayscale(60%)" : "brightness(1)";
      };
      return button;
    }

    _updateUI() {
      if (!this.ui) return;
      const { resumeButton, clearButton, timeIndicator } = this.ui;

      const last = this.opened[0];
      timeIndicator.textContent = last ? `(opened ${formatTimeAgo(last.timestamp)})` : "";

      resumeButton.disabled = this.isSearching || this.opened.length === 0;
      clearButton.disabled = this.isSearching || this.opened.length === 0;
      this._applyButtonStyle(resumeButton);
      this._applyButtonStyle(clearButton);
    }

    _applyButtonStyle(button) {
      const disabled = button.disabled;
      button.style.opacity = disabled ? "0.6" : "1";
      button.style.cursor = disabled ? "not-allowed" : "pointer";
      button.style.filter = disabled ? "grayscale(60%)" : "brightness(1)";
    }

    _setStatus(message, color = CONFIG.statusSuccessColor) {
      if (!this.ui?.statusText) return;
      if (this.statusTimeout) {
        clearTimeout(this.statusTimeout);
        this.statusTimeout = null;
      }
      this.ui.statusText.textContent = message || "";
      if (message) this.ui.statusText.style.color = color;
    }

    _clearStatusAfterDelay() {
      if (this.statusTimeout) clearTimeout(this.statusTimeout);
      this.statusTimeout = setTimeout(() => {
        if (this.ui?.statusText) this.ui.statusText.textContent = "";
        this.statusTimeout = null;
      }, CONFIG.statusClearMs);
    }

    // Resume = last clicked video (opened[0]), same target as the UI time indicator.
    async _resume() {
      if (this.isSearching || this.opened.length === 0) return;

      this.isSearching = true;
      this._setStatus("");
      this._updateUI();

      const resumeId = this.opened[0].id;
      let target = null;
      let nearest = false;
      try {
        target = this._findVideoById(getAllLoadedVideos(), resumeId);

        if (!target) {
          window.scrollTo({ top: 0, behavior: "auto" });
          await wait(300);
          let attempts = 0;
          const openedIds = new Set(this.opened.map((entry) => entry.id));
          // Stops when the user navigates away mid-search, or it would keep scrolling whatever page came next.
          while (attempts < CONFIG.maxScrollAttempts && this.active) {
            const videos = getAllLoadedVideos();
            target = this._findVideoById(videos, resumeId);
            if (target) break;
            // A last-opened video that was deleted or made private never loads, and searching only for it scrolled weeks past the user's place.
            const firstOpened = videos.findIndex((video) => openedIds.has(video.id));
            if (firstOpened !== -1 && videos.length - firstOpened > CONFIG.videosPastFirstOpened) break;
            if (!(await scrollAndLoadMore())) break;
            attempts++;
            await wait(400);
          }
          if (!target) {
            target = this._findLatestOpened(getAllLoadedVideos());
            nearest = Boolean(target);
          }
        }

        if (target) this._goTo(target);
      } catch (error) {
        log.error("Resume error:", error);
      } finally {
        this.isSearching = false;
        this._updateUI();
        this._setStatus(
          !target ? UI_TEXT.STATUS_NOTFOUND : nearest ? UI_TEXT.STATUS_NEAREST : UI_TEXT.STATUS_FOUND,
          target ? CONFIG.statusSuccessColor : CONFIG.statusErrorColor,
        );
        this._clearStatusAfterDelay();
      }
    }

    _findVideoById(videos, id) {
      for (const video of videos) {
        if (video.id === id && document.body.contains(video.element)) return video;
      }
      return null;
    }

    _findLatestOpened(videos) {
      const loaded = new Map(videos.map((video) => [video.id, video]));
      for (const entry of this.opened) {
        const video = loaded.get(entry.id);
        if (video && document.body.contains(video.element)) return video;
      }
      return null;
    }

    _goTo(video) {
      log.info(`Resume at "${video.title}" (${video.id})`);
      scrollToElement(video.element);
      highlightElement(video.element, CONFIG.highlightColor, CONFIG.highlightDurationMs);
    }

    _clearProgress() {
      if (this.isSearching || this.opened.length === 0) return;
      this.opened = [];
      saveOpened(this.opened);
      log.info("Cleared opened progress.");
      this._setStatus(UI_TEXT.STATUS_CLEARED);
      this._updateUI();
      this._clearStatusAfterDelay();
    }

    _setupObserver() {
      if (this.observer) this.observer.disconnect();

      const target = document.querySelector(SELECTORS.observerRoot);
      if (!target) return;

      this.observer = new MutationObserver((mutations) => {
        const relevant = mutations.some((mutation) => {
          if (mutation.type !== "childList" || mutation.addedNodes.length === 0) return false;
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (
              node.matches?.(SELECTORS.videoItem) ||
              node.querySelector?.(SELECTORS.videoItem) ||
              node.matches?.(SELECTORS.continuationItem) ||
              node.querySelector?.(SELECTORS.continuationItem)
            ) {
              return true;
            }
          }
          return false;
        });
        if (relevant) this.debouncedHandlePageChange();
      });

      this.observer.observe(target, { childList: true, subtree: true });
    }

    _handlePageChange() {
      // The debounce can fire after navigation has already deactivated the tracker.
      if (this.isSearching || !this.active) return;

      const ui = document.getElementById(UI_CONTAINER_ID);
      if (!ui || !document.body.contains(ui)) {
        this._initWhenReady();
      } else {
        ui.style.display = "";
        this._updateUI();
      }
    }
  }

  new YouTubeTracker();
})();
