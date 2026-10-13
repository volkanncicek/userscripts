// ==UserScript==
// @name         YouTube: Ask Gemini
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/youtube-ask-gemini.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/youtube-ask-gemini.user.js
// @description  Adds a Gemini button to the YouTube watch page. One click hands the video's title, channel, link and full description to Gemini in a new tab, types the prompt into the composer and submits it.
// @author       volkan.cicek
// @match        https://www.youtube.com/*
// @match        https://gemini.google.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const GEMINI_URL = "https://gemini.google.com/app";
  const BUTTON_ID = "yt-ask-gemini-button";

  // Every selector below belongs to a page we do not control, so both sites keep their selectors in one place: when YouTube or Gemini reshuffles its DOM, the fix is a single line here rather than a hunt.
  const SELECTORS = {
    youtube: {
      // The Like/Share row on the watch page. Both ids have coexisted across YouTube layouts, so try each.
      actionRow: ["#top-level-buttons-computed", "ytd-watch-metadata #actions-inner #menu #top-level-buttons-computed"],
      // Only used if the player response is unreachable; the description never comes from the DOM (see VideoContext).
      title: ["ytd-watch-metadata h1 yt-formatted-string", "ytd-watch-metadata h1", "h1.ytd-watch-metadata"],
      channel: [
        "ytd-watch-metadata ytd-channel-name a",
        "#owner #channel-name a",
        "ytd-video-owner-renderer #channel-name a",
      ],
    },
    gemini: {
      editor: [
        'rich-textarea div[contenteditable="true"]',
        'div.ql-editor[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
      ],
      sendButton: ["button.send-button", 'button[aria-label*="Send" i]', 'button[aria-label*="Gönder" i]'],
    },
  };

  const CONFIG = {
    descriptionMaxChars: 8000, // longer descriptions are truncated; the composer gets slow past this
    payloadMaxAgeMs: 60000, // a payload older than this is ignored, so a Gemini tab opened by hand never fires a stale prompt
    payloadWaitMs: 10000, // how long a fresh Gemini tab waits for the prompt the YouTube side is still assembling
    pollIntervalMs: 1000, // YouTube navigation events are unreliable, so poll the URL instead
    elementTimeoutMs: 15000, // how long to wait for a selector before giving up
    submitTimeoutMs: 8000, // how long to wait for the send button to become clickable after typing
  };

  // One prompt on purpose. Anything more specific (is it worth watching, extract the steps, just the numbers) is a follow-up message in a chat that is already open, which costs one line there instead of a menu here. {title}, {channel}, {url} and {description} are substituted before sending.
  const PROMPT = `Aşağıdaki YouTube videosu ne anlatıyor? İzlemeden anlamak istiyorum.

Başlık: {title}
Kanal: {channel}
Link: {url}

Açıklama:
{description}

Videonun ne tür bir video olduğunu kendin belirle ve anlatımı ona göre kur: anlatım, inceleme, uygulama, haber, yorum, sohbet ya da başka bir şey. Türü ayrıca yazma, sadece anlatımı ona göre şekillendir.

- Başlık bir soru soruyorsa ya da bir iddia ortaya atıyorsa, videonun buna verdiği yanıtı en başta net olarak söyle.
- Anlatımı konu başlıklarına göre kur, videonun kronolojisine göre değil. Zaman damgası ya da dakika aralığı verme; sadece belirli bir yere gitmek gerçekten gerekiyorsa (bir demo, bir gösterim, bir ölçüm) o tek yerin dakikasını parantez içinde ekle.
- Konunun kendisini anlat: "şu konuya değiniyor" deyip geçme, o konuda ne söylendiğini yaz.
- Uzunluğu videonun yoğunluğuna göre ayarla. Dolu bir videoyu birkaç maddeye indirme, içi boş bir videoyu da uzatma.

Videoda karşılığı olmayan bir şey uydurma; bilmiyorsan bilmiyorum de.
Aktarılan olgu ile sunucunun kendi yorumunu birbirinden ayır.
Geçen isimleri, rakamları, tarihleri, ürün ve araç adlarını aynen koru, Türkçeye çevirme.
Listeleri numaralandırma, madde olarak yaz; sıralamanın kendisi anlam taşımıyorsa numara kullanma.`;

  const BUTTON_STYLE = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 36px;
      padding: 0 16px;
      margin-left: 8px;
      border: none;
      border-radius: 18px;
      background: var(--yt-spec-badge-chip-background, rgba(255,255,255,0.1));
      color: var(--yt-spec-text-primary, #f1f1f1);
      font-family: "Roboto", "Arial", sans-serif;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
    `;

  const log = {
    info: (...args) => console.log("[YouTube: Ask Gemini]", ...args),
    warn: (...args) => console.warn("[YouTube: Ask Gemini]", ...args),
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function queryAny(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  // Resolves null on timeout so callers can decide what a miss means rather than handling a rejection.
  async function waitForAny(selectors, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    do {
      const element = queryAny(selectors);
      if (element) return element;
      await sleep(200);
    } while (Date.now() < deadline);
    return null;
  }

  function textOf(selectors) {
    const element = queryAny(selectors);
    return element ? element.textContent.trim() : "";
  }

  // Everything the prompt needs to know about one video, plus the template substitution that consumes it.
  class VideoContext {
    constructor({ videoId, title, channel, description }) {
      this.videoId = videoId;
      this.title = title;
      this.channel = channel;
      this.description = description;
    }

    get url() {
      return `https://www.youtube.com/watch?v=${this.videoId}`;
    }

    // Title, channel and description all come from YouTube's own player response rather than the DOM: the collapsed description element yields a truncated text ending in "...more", plus chrome like the "Music / 1 song" block, while the player response carries the full text clean.
    static async forVideo(videoId) {
      let details = {};
      try {
        details = VideoContext._readPlayerResponse(videoId) || (await VideoContext._fetchWatchPage(videoId));
      } catch (error) {
        log.warn("Could not read video details, falling back to the DOM:", error);
      }

      return new VideoContext({
        videoId,
        title: details.title || textOf(SELECTORS.youtube.title) || document.title.replace(/ - YouTube$/, ""),
        channel: details.author || textOf(SELECTORS.youtube.channel) || "(bilinmiyor)",
        description: VideoContext._clamp(details.shortDescription) || "(açıklama yok)",
      });
    }

    // The live page object is the cheap path, but it can go stale across SPA navigations, so the video id is checked rather than trusted. Returns null when it cannot be used, which sends the caller to the fetch.
    static _readPlayerResponse(videoId) {
      const details = unsafeWindow.ytInitialPlayerResponse?.videoDetails;
      return details?.videoId === videoId ? details : null;
    }

    // Same-origin refetch of the watch page, verified to carry the same title, author and full description as the live object. The fields are picked out by regex because parsing the whole response buys nothing here.
    static async _fetchWatchPage(videoId) {
      log.info("Player response stale or unreachable, refetching watch page");
      const html = await fetch(`https://www.youtube.com/watch?v=${videoId}`).then((response) => response.text());
      const pick = (key) => {
        const match = html.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`));
        return match ? JSON.parse(`"${match[1]}"`) : "";
      };
      return { title: pick("title"), author: pick("author"), shortDescription: pick("shortDescription") };
    }

    static _clamp(description) {
      const text = (description || "").trim();
      return text.length > CONFIG.descriptionMaxChars
        ? `${text.slice(0, CONFIG.descriptionMaxChars)}\n\n[açıklama bu noktada kesildi]`
        : text;
    }

    // Substituted through a replacer function rather than a plain string, because a description containing something like $& or $1 would otherwise be re-interpreted by replace() and corrupt the prompt.
    render(template) {
      const values = { title: this.title, channel: this.channel, url: this.url, description: this.description };
      return template.replace(/\{(title|channel|url|description)\}/g, (match, key) => values[key] ?? match);
    }
  }

  // The contract between the two sides. YouTube and Gemini are different origins, so localStorage cannot carry the prompt across; GM storage is shared per script and is the only channel available. Both the key and the freshness rules live here so neither side can drift from the other.
  class PromptBridge {
    static STORAGE_KEY = "yt_ask_gemini_pending";

    static put(text) {
      GM_setValue(PromptBridge.STORAGE_KEY, { text, createdAt: Date.now() });
      log.info(`Prompt queued (${text.length} chars)`);
    }

    // The prompt can land slightly after the Gemini tab opens, because the YouTube side opens the tab before it has finished collecting the video's details. So poll briefly rather than reading once and giving up.
    // The payload is consumed on read and single-shot on purpose: with auto-submit on, one left behind would fire again on the next Gemini tab opened for an unrelated reason.
    static async take() {
      const deadline = Date.now() + CONFIG.payloadWaitMs;
      do {
        const payload = GM_getValue(PromptBridge.STORAGE_KEY, null);
        if (payload) {
          GM_deleteValue(PromptBridge.STORAGE_KEY);
          if (Date.now() - payload.createdAt > CONFIG.payloadMaxAgeMs) {
            log.info("Pending prompt was stale, ignored");
            return null;
          }
          return payload;
        }
        await sleep(200);
      } while (Date.now() < deadline);
      return null;
    }
  }

  class GeminiLauncher {
    constructor() {
      this.currentVideoId = null;
      this.injecting = false; // guards against the 1s poll stacking up waiters while the action row is missing
    }

    start() {
      setInterval(() => this._poll(), CONFIG.pollIntervalMs);
    }

    _poll() {
      const videoId = new URLSearchParams(window.location.search).get("v");
      if (!videoId) {
        this.currentVideoId = null;
        return;
      }
      // Re-inject when the video changed or when YouTube rebuilt the action row and dropped our button.
      if (videoId !== this.currentVideoId || !document.getElementById(BUTTON_ID)) {
        this.currentVideoId = videoId;
        this._injectButton();
      }
    }

    async _injectButton() {
      if (this.injecting) return;
      this.injecting = true;
      try {
        const actionRow = await waitForAny(SELECTORS.youtube.actionRow, CONFIG.elementTimeoutMs);
        if (!actionRow) return log.warn("Action row not found; button not injected");
        if (document.getElementById(BUTTON_ID)) return;

        const button = document.createElement("button");
        button.id = BUTTON_ID;
        button.style.cssText = BUTTON_STYLE;
        button.textContent = "✦ Gemini";
        button.addEventListener("click", () => this._send());

        actionRow.appendChild(button);
        log.info("Button injected");
      } finally {
        this.injecting = false;
      }
    }

    async _send() {
      // Open the tab while the click is still the browser's current user gesture. Collecting the details first would push window.open past the activation window and let a popup blocker swallow it; Gemini waits.
      window.open(GEMINI_URL, "_blank");

      const context = await VideoContext.forVideo(this.currentVideoId);
      PromptBridge.put(context.render(PROMPT));
    }
  }

  class GeminiComposer {
    async start() {
      const payload = await PromptBridge.take();
      if (!payload) return;

      log.info("Pending prompt found");
      const editor = await waitForAny(SELECTORS.gemini.editor, CONFIG.elementTimeoutMs);
      if (!editor) {
        return log.warn("Composer not found; prompt lost. Selectors in SELECTORS.gemini.editor need updating.");
      }

      if (!this._type(editor, payload.text)) return log.warn("Could not write into the composer; prompt lost.");
      log.info("Prompt written");

      await this._submit();
    }

    // Gemini's composer is a rich-text editor that discards a plain textContent assignment: only a real input event updates its internal model, which is what execCommand("insertText") produces.
    _type(editor, text) {
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);

      if (document.execCommand("insertText", false, text) && editor.textContent.trim()) return true;

      // Fallback for browsers where execCommand is unavailable. Less reliable, hence second.
      editor.textContent = text;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      return !!editor.textContent.trim();
    }

    // The send button stays disabled for a moment after the text lands, so poll for a clickable one rather than clicking once and hoping. Enter is deliberately not simulated: the prompt is multi-line.
    async _submit() {
      const deadline = Date.now() + CONFIG.submitTimeoutMs;
      do {
        const button = queryAny(SELECTORS.gemini.sendButton);
        if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
          button.click();
          return log.info("Prompt submitted");
        }
        await sleep(200);
      } while (Date.now() < deadline);
      log.warn("Send button never became clickable; the prompt is waiting in the composer, press Enter yourself.");
    }
  }

  if (location.hostname.endsWith("youtube.com")) {
    new GeminiLauncher().start();
  } else if (location.hostname.endsWith("gemini.google.com")) {
    new GeminiComposer().start();
  }
})();
