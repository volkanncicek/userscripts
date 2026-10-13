// ==UserScript==
// @name         Sahibinden Sequential Photo Downloader
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16.1
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/sahibinden-photo-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/sahibinden-photo-downloader.user.js
// @description  Downloads every photo of a Sahibinden listing as one zip, numbered in listing order
// @author       volkan.cicek
// @match        https://www.sahibinden.com/ilan/*
// @connect      shbdn.com
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(() => {
  "use strict";

  const THUMBNAIL_SELECTOR = ".megaPhotoThmbItem img";
  const BUTTON_LABEL = "📥 Download All Photos";
  const STATUS_RESET_MS = 8000;

  const log = {
    info: (...args) => console.log("[Sahibinden Sequential Photo Downloader]", ...args),
    error: (...args) => console.error("[Sahibinden Sequential Photo Downloader]", ...args),
  };

  const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  // Listing photos are AVIF or JPEG and already compressed, so entries are stored rather than deflated; that keeps the zip writer small enough to inline instead of depending on a library. Layout follows PKWARE's APPNOTE: a local header before each file, then the central directory, then the end record.
  function buildZip(files) {
    const encoder = new TextEncoder();
    const { time, date } = dosDateTime(new Date());
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const { name, bytes } of files) {
      const nameBytes = encoder.encode(name);
      const crc = crc32(bytes);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, bytes.length, true);
      local.setUint32(22, bytes.length, true);
      local.setUint16(26, nameBytes.length, true);
      localParts.push(local, nameBytes, bytes);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(8, 0x0800, true);
      central.setUint16(12, time, true);
      central.setUint16(14, date, true);
      central.setUint32(16, crc, true);
      central.setUint32(20, bytes.length, true);
      central.setUint32(24, bytes.length, true);
      central.setUint16(28, nameBytes.length, true);
      central.setUint32(42, offset, true);
      centralParts.push(central, nameBytes);

      offset += 30 + nameBytes.length + bytes.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  const fetchBytes = (url) =>
    new Promise((resolve, reject) =>
      GM_xmlhttpRequest({
        url,
        responseType: "arraybuffer",
        onload: (response) =>
          response.status === 200
            ? resolve(new Uint8Array(response.response))
            : reject({ error: `http_${response.status}` }),
        onerror: () => reject({ error: "network" }),
        ontimeout: () => reject({ error: "timeout" }),
      }),
    );

  // One zip instead of one download per photo: GM_download loses file names whenever a download-manager extension is installed, and Chrome holds back repeated downloads from a page until the site is allowed to download multiple files, a refusal the page cannot see.
  function saveBlob(blob, name) {
    const href = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href, download: name }).click();
    // The browser reads the blob after the click returns, so revoking at once would cancel the save.
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }

  const fullSizeUrl = (thumbnail) =>
    thumbnail.getAttribute("data-source") || (thumbnail.src || "").replace("thmb_", "x16_");

  const listingId = () => location.pathname.match(/-(\d+)\/detay/)?.[1] ?? "photos";

  async function downloadAllPhotos(showStatus) {
    const thumbnails = [...document.querySelectorAll(THUMBNAIL_SELECTOR)];
    if (thumbnails.length === 0) return "No photos found";

    const files = [];
    const failures = [];
    for (const [index, thumbnail] of thumbnails.entries()) {
      const url = fullSizeUrl(thumbnail);
      if (!url) {
        failures.push("no_url");
        continue;
      }
      const extension = url.split(".").pop().split(/#|\?/)[0];
      const name = `listing-photo-${String(index + 1).padStart(2, "0")}.${extension}`;

      showStatus(`Fetching ${index + 1}/${thumbnails.length}…`);
      try {
        files.push({ name, bytes: await fetchBytes(url) });
      } catch (error) {
        failures.push(error?.error || "unknown");
        log.error("Fetch failed:", url, error);
      }
    }
    if (files.length === 0) return `No photo could be fetched (${[...new Set(failures)].join(", ")})`;

    saveBlob(buildZip(files), `sahibinden-${listingId()}.zip`);
    const reasons = failures.length ? `, failed ${failures.length} (${[...new Set(failures)].join(", ")})` : "";
    return `Zipped ${files.length}/${thumbnails.length}${reasons}`;
  }

  function addDownloadButton() {
    const button = document.createElement("button");
    button.textContent = BUTTON_LABEL;
    Object.assign(button.style, {
      position: "fixed",
      top: "20px",
      right: "20px",
      zIndex: "99999",
      padding: "10px 15px",
      background: "#ffb100",
      border: "none",
      color: "#000",
      fontWeight: "bold",
      cursor: "pointer",
      borderRadius: "6px",
    });
    const showStatus = (text) => (button.textContent = text);
    // The result is shown on the button rather than in an alert, which would block the page until dismissed.
    button.onclick = async () => {
      button.disabled = true;
      try {
        const result = await downloadAllPhotos(showStatus);
        log.info(result);
        showStatus(result);
      } finally {
        button.disabled = false;
        setTimeout(() => showStatus(BUTTON_LABEL), STATUS_RESET_MS);
      }
    };
    document.body.appendChild(button);
  }

  window.addEventListener("load", addDownloadButton);
})();
