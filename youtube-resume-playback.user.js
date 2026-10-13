// ==UserScript==
// @name         YouTube: Resume Where Left Off
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/youtube-resume-playback.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/youtube-resume-playback.user.js
// @description  Resume YouTube videos from where you left off, even with watch history disabled. URL polling + a single listener keep it stable.
// @author       volkan.cicek
// @match        https://www.youtube.com/*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const STORAGE_PREFIX = "yt_resume_";
  // Target the main player's video specifically, so sidebar hover-preview <video> elements are never picked.
  const MAIN_VIDEO_SELECTOR = "#movie_player video.html5-main-video";

  const CONFIG = {
    expireDays: 30, // saved positions older than this are purged
    pollIntervalMs: 1000, // YouTube navigation events are unreliable, so poll the URL instead
    skipStartS: 5, // don't save/resume within the first N seconds
    skipEndS: 10, // don't save within the last N seconds (a finished video should start fresh)
    resumeThresholdS: 5, // if the player is already within N seconds of the target, leave it alone
  };

  const log = (...args) => console.log("[YouTube: Resume Where Left Off]", ...args);

  function getVideoIdFromUrl() {
    return new URLSearchParams(window.location.search).get("v");
  }

  function isAdPlaying() {
    const player = document.querySelector(".html5-video-player");
    return !!player && player.classList.contains("ad-showing");
  }

  function getMainVideo() {
    return document.querySelector(MAIN_VIDEO_SELECTOR);
  }

  function saveProgress(videoId, time) {
    localStorage.setItem(STORAGE_PREFIX + videoId, JSON.stringify({ time, timestamp: Date.now() }));
  }

  function loadProgress(videoId) {
    const raw = localStorage.getItem(STORAGE_PREFIX + videoId);
    if (!raw) return null;
    try {
      return JSON.parse(raw).time ?? null;
    } catch {
      return null;
    }
  }

  function purgeExpired(maxAgeMs) {
    const now = Date.now();
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(STORAGE_PREFIX)) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key));
        if (!data?.timestamp || now - data.timestamp > maxAgeMs) localStorage.removeItem(key);
      } catch {
        localStorage.removeItem(key);
      }
    }
  }

  class ResumePlayer {
    constructor() {
      this.currentVideoId = null;
      this.pendingResumeTime = null; // resume target waiting to be applied (e.g. while a pre-roll ad plays)
      this.boundVideos = new WeakSet(); // <video> elements that already carry our timeupdate listener
    }

    start() {
      purgeExpired(CONFIG.expireDays * 24 * 60 * 60 * 1000);
      setInterval(() => this._poll(), CONFIG.pollIntervalMs);
    }

    _poll() {
      const videoId = getVideoIdFromUrl();
      if (!videoId) {
        this.currentVideoId = null;
        return;
      }
      if (videoId !== this.currentVideoId) this._setupVideo(videoId);
    }

    _setupVideo(videoId) {
      const video = getMainVideo();
      if (!video) return; // player not in the DOM yet; currentVideoId stays unchanged so the next poll retries

      log(`New video: ${videoId}`);
      this.currentVideoId = videoId;
      this.pendingResumeTime = null;
      this._attachSaver(video);

      const savedTime = loadProgress(videoId);
      if (!savedTime || savedTime <= 0) return;

      // Try to apply right away; if an ad is playing, leave it pending for the timeupdate handler.
      this.pendingResumeTime = savedTime;
      const apply = () => this._applyPendingResume(video);
      if (video.readyState >= 1) apply();
      else video.addEventListener("loadedmetadata", apply, { once: true });
    }

    _applyPendingResume(video) {
      const target = this.pendingResumeTime;
      if (target == null || isAdPlaying()) return; // stays pending; timeupdate retries once the ad ends
      if (target < video.duration && Math.abs(video.currentTime - target) > CONFIG.resumeThresholdS) {
        video.currentTime = target;
        log(`Resumed at ${Math.floor(target)}s`);
      }
      this.pendingResumeTime = null;
    }

    // Attach the timeupdate listener to a <video> exactly once. YouTube reuses the same element across
    // navigations, so re-binding per video would leak listeners; one listener reads currentVideoId instead.
    _attachSaver(video) {
      if (this.boundVideos.has(video)) return;
      this.boundVideos.add(video);

      let lastSavedSecond = -1;
      video.addEventListener("timeupdate", () => {
        const videoId = this.currentVideoId;
        if (!videoId || isAdPlaying()) return;

        this._applyPendingResume(video); // covers the "ad was playing at load time" case

        const currentTime = video.currentTime;
        const second = Math.floor(currentTime);
        if (
          second !== lastSavedSecond &&
          currentTime > CONFIG.skipStartS &&
          video.duration - currentTime > CONFIG.skipEndS
        ) {
          lastSavedSecond = second;
          saveProgress(videoId, currentTime);
        }
      });
    }
  }

  new ResumePlayer().start();
})();
