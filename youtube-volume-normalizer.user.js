// ==UserScript==
// @name         YouTube: Volume Normalizer
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/youtube-volume-normalizer.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/youtube-volume-normalizer.user.js
// @description  Boosts quiet YouTube videos up to YouTube's own loudness target, with a limiter to keep the boost from clipping.
// @author       volkan.cicek
// @match        https://www.youtube.com/*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const MAIN_VIDEO_SELECTOR = "#movie_player video.html5-main-video";
  const PLAYER_SELECTOR = "#movie_player";

  const CONFIG = {
    // The loudness reading shows up a moment after playback starts and mid-roll ads come without a page event, so the poll runs for the life of the page.
    pollIntervalMs: 1500,
    // Beyond this a boost mostly amplifies noise and hiss.
    maxBoostDb: 15,
    // Ramping the gain over a few tens of milliseconds avoids an audible click when it changes mid-playback.
    gainTimeConstantS: 0.05,
    limiter: { threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.25 },
  };

  const log = (...args) => console.log("[YouTube: Volume Normalizer]", ...args);

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const currentVideoId = () => new URLSearchParams(location.search).get("v");

  // Returns content loudness minus YouTube's target in dB, read from the "cont. / tgt." figures in getStatsForNerds(); negative means the video is quieter than the target.
  function readRelativeLoudnessDb(player, videoId) {
    if (typeof player.getStatsForNerds !== "function") return null;
    let stats;
    try {
      stats = player.getStatsForNerds();
    } catch {
      return null;
    }
    // While an ad plays, or just after navigating, the stats still describe another video, so a reading only counts when it names the one in the URL.
    const statsVideo = stats?.video_id_and_cpn;
    if (typeof statsVideo !== "string" || !statsVideo.startsWith(videoId)) return null;
    for (const value of Object.values(stats)) {
      if (typeof value !== "string") continue;
      const match = value.match(/cont\.?\s*(-?[\d.]+)\s*dB.*?tgt\.?\s*(-?[\d.]+)\s*dB/i);
      if (match) return parseFloat(match[1]) - parseFloat(match[2]);
    }
    return null;
  }

  // The gain comes first so the limiter sees the boosted signal and can hold down exactly the peaks the boost pushed past full scale.
  class AudioGraph {
    constructor(video) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      const limiter = this.context.createDynamicsCompressor();
      for (const [param, value] of Object.entries(CONFIG.limiter)) limiter[param].value = value;
      this.context
        .createMediaElementSource(video)
        .connect(this.gain)
        .connect(limiter)
        .connect(this.context.destination);

      // Once the element is routed through the context, a suspended context means silence, and browsers only allow resuming after a user gesture.
      const resume = () => {
        if (this.context.state === "suspended") this.context.resume().catch(() => {});
      };
      resume();
      video.addEventListener("playing", resume);
      document.addEventListener("click", resume, { once: true });
    }

    setBoostDb(boostDb) {
      this.gain.gain.setTargetAtTime(10 ** (boostDb / 20), this.context.currentTime, CONFIG.gainTimeConstantS);
    }
  }

  // createMediaElementSource throws on a second call for the same element, and YouTube keeps one <video> across navigations, so each element gets one graph for its lifetime. A failed build is remembered as null so it is not retried on every poll.
  const graphs = new WeakMap();

  function graphFor(video) {
    if (!graphs.has(video)) {
      try {
        graphs.set(video, new AudioGraph(video));
      } catch (error) {
        log("could not build the audio graph; another script may already own this video's audio:", error.message);
        graphs.set(video, null);
      }
    }
    return graphs.get(video);
  }

  let appliedKey = null;

  // Clearing the key makes the next reading re-apply the boost even when it matches the one before the reset.
  function resetToUnity(graph) {
    graph.setBoostDb(0);
    appliedKey = null;
  }

  function evaluate() {
    const videoId = currentVideoId();
    if (!videoId) return;
    const player = document.querySelector(PLAYER_SELECTOR);
    const video = document.querySelector(MAIN_VIDEO_SELECTOR);
    if (!player || !video) return;
    const graph = graphFor(video);
    if (!graph) return;

    // Ads play through the same <video>, so the video's boost would otherwise apply to the ad.
    if (player.classList.contains("ad-showing")) {
      if (appliedKey !== null) {
        resetToUnity(graph);
        log("ad showing, gain back to unity");
      }
      return;
    }

    const relativeDb = readRelativeLoudnessDb(player, videoId);
    if (relativeDb === null) return;

    const boostDb = clamp(-relativeDb, 0, CONFIG.maxBoostDb);
    const key = `${videoId}:${boostDb}`;
    if (key !== appliedKey) {
      appliedKey = key;
      graph.setBoostDb(boostDb);
      log(`${videoId}: ${relativeDb.toFixed(1)} dB against the target, boost +${boostDb.toFixed(1)} dB`);
    }
  }

  // The previous video's boost would otherwise carry over into the next video's first seconds until its own reading arrives.
  function onNavigate() {
    const video = document.querySelector(MAIN_VIDEO_SELECTOR);
    const graph = video && graphs.get(video);
    if (graph) resetToUnity(graph);
    evaluate();
  }

  document.addEventListener("yt-navigate-finish", onNavigate);
  setInterval(evaluate, CONFIG.pollIntervalMs);
  evaluate();
})();
