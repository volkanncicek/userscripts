// ==UserScript==
// @name         YouTube - Resize Player (Reveal Metadata)
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.13.1
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/youtube-resize-player.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/youtube-resize-player.user.js
// @description  Shrinks the video player slightly so the title and date are visible without scrolling.
// @author       volkan.cicek
// @match        https://www.youtube.com/*
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(() => {
  "use strict";

  // Every rule excludes theater and fullscreen, so the player is only shrunk in the default layout.
  const PLAYER_CSS = `
    @media (min-width: 1000px) {
      ytd-watch-flexy:not([theater]):not([fullscreen]) #player-container-outer,
      ytd-watch-flexy:not([theater]):not([fullscreen]) #player-container-inner,
      ytd-watch-flexy:not([theater]):not([fullscreen]) #player-container {
        max-height: 80vh !important;
      }

      ytd-watch-flexy:not([theater]):not([fullscreen]) #player-container-outer {
        max-width: 85% !important;
        margin: 0 auto !important;
        /* Without this the aspect ratio wins over the height limit on square videos. */
        aspect-ratio: auto !important;
      }

      /* The video element itself is what left the gap; .ytp-fullscreen keeps it unconstrained in fullscreen. */
      ytd-watch-flexy:not([theater]):not([fullscreen]) #movie_player:not(.ytp-fullscreen) .html5-video-container video {
        max-height: 80vh !important;
      }

      ytd-watch-flexy:not([theater]):not([fullscreen]) #columns {
        margin-top: 10px !important;
      }
    }
  `;

  // GM_addStyle rather than document.head, which may not exist yet at document-start.
  GM_addStyle(PLAYER_CSS);
})();
