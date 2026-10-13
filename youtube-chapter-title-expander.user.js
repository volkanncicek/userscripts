// ==UserScript==
// @name         YouTube Chapter Title Expander
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/youtube-chapter-title-expander.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/youtube-chapter-title-expander.user.js
// @description  Stops long titles in YouTube's "In this video" (Chapters) panel from being truncated and shows the full text.
// @author       volkan.cicek
// @match        https://www.youtube.com/*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const CHAPTER_CSS = `
    ytd-macro-markers-list-item-renderer h3.macro-markers,
    ytd-macro-markers-list-item-renderer h3 {
      display: block !important;
      -webkit-line-clamp: unset !important;
      line-clamp: unset !important;
      max-height: none !important;
      white-space: normal !important;
      overflow: visible !important;
      text-overflow: initial !important;
    }

    /* The row boxes have fixed heights of their own, which would clip the unclamped title. */
    ytd-macro-markers-list-item-renderer,
    ytd-macro-markers-list-item-renderer #endpoint,
    ytd-macro-markers-list-item-renderer #details {
      height: auto !important;
      min-height: min-content !important;
      max-height: none !important;
      overflow: visible !important;
    }

    /* Keeps expanded rows from overlapping each other. */
    ytd-macro-markers-list-item-renderer {
      padding-bottom: 8px !important;
    }
  `;

  const style = document.createElement("style");
  style.textContent = CHAPTER_CSS;
  document.head.appendChild(style);
})();
