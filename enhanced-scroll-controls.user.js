// ==UserScript==
// @name         Enhanced Scroll Controls
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/enhanced-scroll-controls.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/enhanced-scroll-controls.user.js
// @description  Adds a scroll-to-bottom button and an endless scroll toggle on the sites you turn it on for from the Tampermonkey menu.
// @author       volkan.cicek
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-end
// @noframes     true
// ==/UserScript==

(() => {
  "use strict";

  const DEFAULT_CONFIG = {
    scrollBottomButtonColor: "#007bff",
    endlessScrollButtonColor: "#28a745",
    // The scroll-to-bottom button sits above the endless-scroll toggle.
    scrollBottomOffset: 50,
    endlessScrollOffset: 20,
    endlessScrollIntervalMs: 2000,
    buttonZIndex: 9999,
    hoverDarkenAmount: 30,
  };
  // Timings of the script's own lifecycle rather than of a site's buttons, and lateStartDelayMs is read before the site config is resolved, so these stay out of DEFAULT_CONFIG where SITE_CONFIGS could override them.
  const CONFIG = {
    bodyRetryMs: 100,
    navigationDelayMs: 300,
    lateStartDelayMs: 500,
  };
  // Keyed by a hostname fragment; the first match overrides the defaults.
  const SITE_CONFIGS = {
    "youtube.com": {
      scrollBottomButtonColor: "#FF0000",
      endlessScrollButtonColor: "#FF0000",
      getScrollTarget: () => document.documentElement,
      // YouTube navigates as a SPA and fires this once the new page is in place.
      navigationEvent: "yt-navigate-finish",
      shouldShowButtons: () => !document.fullscreenElement,
    },
  };
  const BUTTON_IDS = {
    scrollBottom: "enhanced-scroll-bottom-button",
    endlessScroll: "enhanced-endless-scroll-button",
  };
  const LABELS = {
    scrollBottom: "↓ Scroll to Bottom",
    startEndless: "🔁 Start Endless Scroll",
    stopEndless: "⏹ Stop Endless Scroll",
  };
  const STORAGE_KEY = "enabledHosts";

  let siteConfig = DEFAULT_CONFIG;
  let endlessScrollActive = false;
  let endlessScrollTimer;
  let scrollBottomButton;
  let endlessScrollButton;
  let buttonObserver = null;
  let menuCommandId = null;

  function resolveSiteConfig() {
    const site = Object.keys(SITE_CONFIGS).find((fragment) => location.hostname.includes(fragment));
    return site ? { ...DEFAULT_CONFIG, ...SITE_CONFIGS[site] } : { ...DEFAULT_CONFIG };
  }

  function scrollTarget() {
    if (siteConfig.getScrollTarget) return siteConfig.getScrollTarget();
    return document.body.scrollHeight > 0 ? document.body : document.documentElement;
  }

  function scrollToBottom() {
    window.scrollTo({ top: scrollTarget().scrollHeight, behavior: "smooth" });
  }

  function darkenHexColor(hex) {
    const channels = [1, 3, 5].map((start) =>
      Math.max(parseInt(hex.slice(start, start + 2), 16) - siteConfig.hoverDarkenAmount, 0),
    );
    return `rgb(${channels.join(", ")})`;
  }

  function createButton(text, bottomOffset, onClick, color) {
    const button = document.createElement("button");
    button.textContent = text;
    Object.assign(button.style, {
      position: "fixed",
      bottom: `${bottomOffset}px`,
      right: "20px",
      padding: "6px 12px",
      fontSize: "12px",
      backgroundColor: color,
      color: "#fff",
      border: "none",
      borderRadius: "4px",
      cursor: "pointer",
      boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
      zIndex: siteConfig.buttonZIndex.toString(),
      display: siteConfig.shouldShowButtons?.() === false ? "none" : "block",
    });
    button.addEventListener("mouseenter", () => {
      button.style.backgroundColor = darkenHexColor(color);
    });
    button.addEventListener("mouseleave", () => {
      button.style.backgroundColor = color;
    });
    button.addEventListener("click", onClick);
    document.body.appendChild(button);
    return button;
  }

  function toggleEndlessScroll() {
    endlessScrollActive = !endlessScrollActive;
    if (endlessScrollActive) {
      endlessScrollButton.textContent = LABELS.stopEndless;
      endlessScrollTimer = setInterval(scrollToBottom, siteConfig.endlessScrollIntervalMs);
    } else {
      endlessScrollButton.textContent = LABELS.startEndless;
      clearInterval(endlessScrollTimer);
    }
  }

  function addButtons() {
    scrollBottomButton?.remove();
    endlessScrollButton?.remove();

    if (!document.body) {
      setTimeout(addButtons, CONFIG.bodyRetryMs);
      return;
    }

    scrollBottomButton = createButton(
      LABELS.scrollBottom,
      siteConfig.scrollBottomOffset,
      scrollToBottom,
      siteConfig.scrollBottomButtonColor,
    );
    scrollBottomButton.id = BUTTON_IDS.scrollBottom;

    endlessScrollButton = createButton(
      LABELS.startEndless,
      siteConfig.endlessScrollOffset,
      toggleEndlessScroll,
      siteConfig.endlessScrollButtonColor,
    );
    endlessScrollButton.id = BUTTON_IDS.endlessScroll;
    // A rebuilt button must not lose track of an endless scroll that is still running.
    if (endlessScrollActive) endlessScrollButton.textContent = LABELS.stopEndless;
  }

  function updateButtonVisibility() {
    if (!scrollBottomButton || !endlessScrollButton || !siteConfig.shouldShowButtons) return;
    const display = siteConfig.shouldShowButtons() ? "block" : "none";
    scrollBottomButton.style.display = display;
    endlessScrollButton.style.display = display;
  }

  const onNavigation = () => setTimeout(addButtons, CONFIG.navigationDelayMs);

  function start() {
    siteConfig = resolveSiteConfig();
    addButtons();

    document.addEventListener("fullscreenchange", updateButtonVisibility);
    if (siteConfig.navigationEvent) window.addEventListener(siteConfig.navigationEvent, onNavigation);

    // Pages that re-render without a navigation event can remove the buttons, so they are re-added when missing.
    buttonObserver = new MutationObserver(() => {
      if (!document.getElementById(BUTTON_IDS.scrollBottom) || !document.getElementById(BUTTON_IDS.endlessScroll)) {
        addButtons();
      }
    });
    buttonObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function stop() {
    buttonObserver?.disconnect();
    buttonObserver = null;
    document.removeEventListener("fullscreenchange", updateButtonVisibility);
    if (siteConfig.navigationEvent) window.removeEventListener(siteConfig.navigationEvent, onNavigation);
    if (endlessScrollActive) toggleEndlessScroll();
    scrollBottomButton?.remove();
    endlessScrollButton?.remove();
  }

  const isEnabledHere = () => GM_getValue(STORAGE_KEY, []).includes(location.hostname);

  function registerMenu() {
    if (menuCommandId !== null) GM_unregisterMenuCommand(menuCommandId);
    const enabled = isEnabledHere();
    menuCommandId = GM_registerMenuCommand(
      enabled ? `Hide scroll buttons on ${location.hostname}` : `Show scroll buttons on ${location.hostname}`,
      () => {
        const hosts = GM_getValue(STORAGE_KEY, []);
        GM_setValue(
          STORAGE_KEY,
          enabled ? hosts.filter((h) => h !== location.hostname) : [...hosts, location.hostname],
        );
        if (enabled) stop();
        else start();
        registerMenu();
      },
    );
  }

  registerMenu();
  if (!isEnabledHere()) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else setTimeout(start, CONFIG.lateStartDelayMs);
})();
