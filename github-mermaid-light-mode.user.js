// ==UserScript==
// @name         GitHub Mermaid Dark Mode Fixer
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.13.1
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/github-mermaid-light-mode.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/github-mermaid-light-mode.user.js
// @description  Forces GitHub Mermaid diagrams to render in light mode so custom colours are not broken.
// @author       volkan.cicek
// @match        https://github.com/*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const MERMAID_IFRAME_SELECTOR = 'iframe[src*="markdown/mermaid"]';
  const DARK_MODE_PARAM = "color_mode=dark";
  const LIGHT_MODE_PARAM = "color_mode=light";
  // A light background and rounded border keep the light diagram from looking out of place on a dark page.
  const FRAME_STYLE = {
    backgroundColor: "#f6f8fa", // GitHub's own light grey
    borderRadius: "8px",
    border: "1px solid #30363d",
  };

  const switchMermaidFramesToLight = () => {
    document.querySelectorAll(MERMAID_IFRAME_SELECTOR).forEach((frame) => {
      if (!frame.src.includes(DARK_MODE_PARAM)) return;
      frame.src = frame.src.replace(DARK_MODE_PARAM, LIGHT_MODE_PARAM);
      Object.assign(frame.style, FRAME_STYLE);
    });
  };

  switchMermaidFramesToLight();
  // GitHub navigates without full reloads, so new diagrams arrive long after the script has run.
  new MutationObserver(switchMermaidFramesToLight).observe(document.body, { childList: true, subtree: true });
})();
