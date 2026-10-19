// ==UserScript==
// @name         Instagram Toolkit
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.19
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/instagram-toolkit.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/instagram-toolkit.user.js
// @description  Cleans up your old Instagram activity: removes your comments, likes, reposts, story replies and reviews from before a date you pick, slowly and only when you start it.
// @author       volkan.cicek
// @match        https://www.instagram.com/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes     true
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = {
    defaultCutoff: "2018-12-31",
  };
  const SELECTORS = {
    panel: "#igtk-panel",
  };
  const TYPES = [
    { key: "comments", path: "comments", label: "Comments" },
    { key: "likes", path: "likes", label: "Likes" },
    { key: "reposts", path: "reposts", label: "Reposts" },
    { key: "storyReplies", path: "story_replies", label: "Story replies" },
    { key: "reviews", path: "reviews", label: "Reviews" },
  ];
  const ACTIVITY_PATH = "/your_activity/interactions/";
  // Opening the panel from another page needs a full navigation, which drops the panel; this flag survives it so the panel reopens on arrival.
  const REOPEN_FLAG = "igtk-reopen-panel";
  const PANEL_CSS = `
    #igtk-panel { position: fixed; top: 16px; right: 16px; z-index: 2147483000; width: 320px; padding: 14px; border-radius: 10px; background: #1c1c1e; color: #f5f5f5; font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); }
    #igtk-panel h2 { margin: 0 0 10px; font-size: 15px; }
    #igtk-panel label { display: block; margin: 4px 0; }
    #igtk-panel input[type="date"] { margin-left: 6px; }
    #igtk-panel .igtk-buttons { display: flex; gap: 6px; margin: 10px 0; }
    #igtk-panel button { flex: 1; padding: 6px; border: 0; border-radius: 6px; background: #0095f6; color: #fff; cursor: pointer; }
    #igtk-panel button:disabled { background: #555; cursor: default; }
    #igtk-panel .igtk-close { position: absolute; top: 8px; right: 10px; flex: none; padding: 0 6px; background: none; color: #aaa; }
    #igtk-panel .igtk-status { white-space: pre-line; color: #ccc; }
  `;

  // The cleaner matches Instagram's English labels and its restriction warnings, so any other UI language could hide a warning it must stop on.
  const isEnglishUi = () => document.documentElement.lang.toLowerCase().startsWith("en");

  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = "igtk-panel";
    panel.innerHTML = `
      <style>${PANEL_CSS}</style>
      <button class="igtk-close" data-igtk="close" title="Close">✕</button>
      <h2>Clean up old activity</h2>
      <label>Remove everything on or before <input type="date" data-igtk="cutoff" value="${CONFIG.defaultCutoff}"></label>
      ${TYPES.map((type) => `<label><input type="checkbox" data-igtk-type="${type.key}" checked> ${type.label}</label>`).join("")}
      <div class="igtk-buttons">
        <button data-igtk="count">Count</button>
        <button data-igtk="start">Start</button>
        <button data-igtk="stop" disabled>Stop</button>
      </div>
      <div class="igtk-status" data-igtk="status"></div>
    `;
    panel.querySelector('[data-igtk="close"]').addEventListener("click", () => panel.remove());
    if (!isEnglishUi()) {
      panel.querySelector('[data-igtk="count"]').disabled = true;
      panel.querySelector('[data-igtk="start"]').disabled = true;
      panel.querySelector('[data-igtk="status"]').textContent = "Switch Instagram to English to use the cleaner.";
    }
    return panel;
  }

  function openPanel() {
    if (!location.pathname.startsWith(ACTIVITY_PATH)) {
      sessionStorage.setItem(REOPEN_FLAG, "1");
      location.assign(`${ACTIVITY_PATH}${TYPES[0].path}`);
      return;
    }
    if (document.querySelector(SELECTORS.panel)) return;
    document.body.append(buildPanel());
  }

  GM_registerMenuCommand("Clean up old activity…", openPanel);
  if (sessionStorage.getItem(REOPEN_FLAG) === "1" && location.pathname.startsWith(ACTIVITY_PATH)) {
    sessionStorage.removeItem(REOPEN_FLAG);
    openPanel();
  }
})();
