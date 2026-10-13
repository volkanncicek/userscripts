// ==UserScript==
// @name         Instagram Gallery Photo Counter
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/instagram-gallery-photo-counter.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/instagram-gallery-photo-counter.user.js
// @description  Shows which photo of an Instagram gallery you are on, such as "3 of 5".
// @author       volkan.cicek
// @match        https://www.instagram.com/*
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  "use strict";

  // The carousel dots are one button per photo with the active one carrying aria-current="step". The classes around them are obfuscated and change between builds, and the buttons' aria-label follows the UI language, so only the ARIA state is relied on.
  const SELECTORS = {
    activeDot: 'button[aria-current="step"]',
    media: "img, video",
  };
  const CONFIG = {
    minFrameWidth: 150,
    maxAncestorSteps: 6,
    heightTolerancePx: 2,
    updateDebounceMs: 100,
  };
  const COUNTER_CLASS = "ig-gallery-counter";
  const COUNTER_CSS = `
    .${COUNTER_CLASS} {
      position: absolute;
      top: 15px;
      right: 15px;
      z-index: 10;
      padding: 5px 10px;
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      font: bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
      pointer-events: none;
    }
  `;

  let updateTimer;

  // The dots sit below the photo, and the nearest ancestor holding any media only holds the "liked by" avatars, so the frame is found from the photo itself: climb from the first full-size media through the wrappers that share its height, which ends at the carousel viewport.
  function findFrame(dotRow) {
    let node = dotRow.parentElement;
    for (let step = 0; node && step < CONFIG.maxAncestorSteps; step++, node = node.parentElement) {
      const photo = [...node.querySelectorAll(SELECTORS.media)].find(
        (media) => media.getBoundingClientRect().width >= CONFIG.minFrameWidth,
      );
      if (!photo) continue;
      const photoHeight = photo.getBoundingClientRect().height;
      let frame = photo.parentElement;
      while (
        frame.parentElement !== node &&
        Math.abs(frame.parentElement.getBoundingClientRect().height - photoHeight) <= CONFIG.heightTolerancePx
      ) {
        frame = frame.parentElement;
      }
      return frame;
    }
    return null;
  }

  function labelGallery(activeDot) {
    const dotRow = activeDot.parentElement;
    const allDots = [...dotRow.children].filter((element) => element.tagName === "BUTTON");
    const activeIndex = allDots.indexOf(activeDot);
    if (allDots.length < 2 || activeIndex < 0) return;
    const frame = findFrame(dotRow);
    if (!frame) return;

    if (getComputedStyle(frame).position === "static") frame.style.position = "relative";
    let counter = frame.querySelector(`:scope > .${COUNTER_CLASS}`);
    if (!counter) {
      counter = document.createElement("div");
      counter.className = COUNTER_CLASS;
      frame.append(counter);
    }
    const text = `${activeIndex + 1} of ${allDots.length}`;
    // Writing only on change keeps the observer below from re-triggering itself.
    if (counter.textContent !== text) counter.textContent = text;
  }

  function scheduleUpdate() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(
      () => document.querySelectorAll(SELECTORS.activeDot).forEach(labelGallery),
      CONFIG.updateDebounceMs,
    );
  }

  GM_addStyle(COUNTER_CSS);

  // Swiping only moves aria-current between the dots, and the feed adds galleries as it scrolls, so both kinds of change count.
  new MutationObserver(scheduleUpdate).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-current"],
  });
  scheduleUpdate();
})();
