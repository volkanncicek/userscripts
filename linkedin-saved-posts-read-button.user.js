// ==UserScript==
// @name         LinkedIn Saved Posts Read Button
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/linkedin-saved-posts-read-button.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/linkedin-saved-posts-read-button.user.js
// @description  Adds a Read button to LinkedIn saved posts that opens the post in a new tab and greys out its row.
// @author       volkan.cicek
// @match        https://www.linkedin.com/my-items/saved-posts/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=linkedin.com
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const SELECTORS = {
    overflowMenu: ".entity-result__actions-overflow-menu-dropdown",
    activityLink: 'a[href*="urn:li:activity"]',
    updateLink: 'a[href*="/feed/update/"]',
  };
  const BUTTON_CLASS = "vc-read-btn";
  const READ_ROW_CLASS = "vc-read-processed";
  const POLL_MS = 1000;

  const STYLE = `
    .${BUTTON_CLASS} {
      background-color: #0a66c2;
      color: white;
      border: none;
      border-radius: 20px;
      padding: 6px 16px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      margin-right: 12px;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      height: 32px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      z-index: 9999;
    }
    .${BUTTON_CLASS}:hover {
      background-color: #004182;
    }
    .${BUTTON_CLASS}:active {
      transform: scale(0.98);
    }
    .${READ_ROW_CLASS} {
      opacity: 0.2 !important;
      filter: grayscale(100%);
      transition: opacity 0.3s;
      background-color: #f3f3f3;
    }
    ${SELECTORS.overflowMenu} {
      display: flex;
      align-items: center;
    }
  `;

  // Matching on the post URL rather than class names survives LinkedIn's class churn.
  function findPostUrl(row) {
    const link = row.querySelector(SELECTORS.activityLink) || row.querySelector(SELECTORS.updateLink);
    return link?.href || null;
  }

  function createReadButton(row, postUrl) {
    const button = document.createElement("button");
    button.className = BUTTON_CLASS;
    button.textContent = "⚡ Read";
    button.title = "Open in a new tab and mark";
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.open(postUrl, "_blank");
      row.classList.add(READ_ROW_CLASS);
    };
    return button;
  }

  function addReadButtons() {
    for (const menu of document.querySelectorAll(SELECTORS.overflowMenu)) {
      const actions = menu.parentElement;
      if (actions.querySelector(`.${BUTTON_CLASS}`)) continue;

      const row = menu.closest("li");
      if (!row) continue;

      const postUrl = findPostUrl(row);
      if (!postUrl) continue;

      actions.insertBefore(createReadButton(row, postUrl), menu);
      actions.style.display = "flex";
      actions.style.alignItems = "center";
      actions.style.justifyContent = "flex-end";
    }
  }

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  // Polling, because a MutationObserver missed rows added while scrolling this DOM.
  setInterval(addReadButtons, POLL_MS);
})();
