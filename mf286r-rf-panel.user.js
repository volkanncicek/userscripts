// ==UserScript==
// @name         MF286R RF Panel
// @namespace    github.com/volkanncicek/userscripts
// @version      2026.10.16
// @updateURL    https://raw.githubusercontent.com/volkanncicek/userscripts/main/mf286r-rf-panel.user.js
// @downloadURL  https://raw.githubusercontent.com/volkanncicek/userscripts/main/mf286r-rf-panel.user.js
// @description  ZTE MF286R (TT Magnet) live RF dashboard with red/green bars + per-metric hover tooltips, instant ↓/↑ throughput + session uptime, a CellMapper deep link for the serving tower, DNS set, and a 4G-only (RAT) lock. Self-contained, runs against the modem web UI. Verified against firmware FW_TT_ZTE_MF286R_v01_20240918 (goform API, field names + AD-hash scheme read from the modem's own service.js/net_select.js).
// @author       volkan.cicek
// @match        http://192.168.0.1/*
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = {
    pollMs: 2000,
    defaultMapZoom: 15,
  };
  // The home location lives in this script's Tampermonkey storage as `home` = { lat, lon, zoom? } so it never enters
  // the public source. CellMapper has no URL parameter that jumps to an eNB (it strips `site=`) but honours
  // latitude/longitude, so with a home set the tower link opens on the local towers. Blank opens the plain provider map.
  const HOME = GM_getValue("home", { lat: "", lon: "" });
  const ENDPOINTS = {
    get: "/goform/goform_get_cmd_process",
    set: "/goform/goform_set_cmd_process",
  };
  const POSITION_KEY = "mfrf-pos";
  // A superset of fields: firmware builds differ in whether they expose `sinr` or `Z_SINR`, `rsrq` or `lte_rsrq`, and
  // each metric picks the first non-empty candidate.
  const POLL_FIELDS = [
    "network_type",
    "rssi",
    "lte_rsrp",
    "rsrq",
    "lte_rsrq",
    "sinr",
    "Z_SINR",
    "lte_snr",
    "wan_lte_ca",
    "lte_ca_pcell_band",
    "lte_ca_pcell_bandwidth",
    "lte_ca_scell_band",
    "lte_ca_scell_info",
    "Z_eNB_id",
    "Z_CELL_ID",
    "mcc",
    "mnc",
    "wan_ipaddr",
    "realtime_time",
    "realtime_rx_bytes",
    "realtime_tx_bytes",
    "ppp_status",
    "network_provider",
  ].join(",");
  const COLORS = { good: "#2e9e4f", ok: "#caa515", bad: "#c0392b", error: "#ff8a8a" };

  // `min`/`max` span the bar; at or above `good` is green, at or above `ok` yellow, else red. Higher is better for all.
  const METRICS = {
    rsrp: {
      label: "RSRP",
      unit: "dBm",
      min: -125,
      max: -70,
      good: -90,
      ok: -105,
      pick: (data) => data.lte_rsrp,
      tip: "RSRP — Reference signal power (core coverage). >-80 excellent · -80…-90 good · -90…-100 fair · -100…-110 weak · <-110 cell edge",
    },
    rsrq: {
      label: "RSRQ",
      unit: "dB",
      min: -20,
      max: -3,
      good: -10,
      ok: -15,
      pick: (data) => data.rsrq || data.lte_rsrq,
      tip: "RSRQ — Signal quality / interference-to-load ratio. >-10 good · -10…-15 fair · <-15 poor",
    },
    sinr: {
      label: "SINR",
      unit: "dB",
      min: -5,
      max: 30,
      good: 13,
      ok: 0,
      pick: (data) => data.sinr || data.Z_SINR || data.lte_snr,
      tip: "SINR — Signal / (noise+interference). The biggest factor in speed. >20 excellent · 13…20 good · 0…13 fair · <0 poor",
    },
    rssi: {
      label: "RSSI",
      unit: "dBm",
      min: -100,
      max: -50,
      good: -65,
      ok: -80,
      pick: (data) => data.rssi,
      tip: "RSSI — Total power received in the band (signal+noise combined); says nothing about quality on its own. >-65 strong · -65…-85 fair",
    },
  };
  const ROW_TIPS = {
    mode: "Connection type + operator. LTE_A = LTE-Advanced (Carrier Aggregation active, 2+ bands combined).",
    band: "PCell (primary) + SCell (secondary) frequency bands. B3=1800MHz, B1=2100, B7=2600, B8=900, B20=800. @ = channel width. 🔗 = CA active.",
    cell: "eNB = base station (tower) ID · Cell = sector ID on that tower. Click → opens the CellMapper Türk Telekom LTE map; typing the eNB number into the CellMapper search box jumps to the tower (the modem has no GPS, so the URL cannot go straight to the location).",
    ip: "WAN IP the modem got from the operator. 10.x = CGNAT (operator internal network), not a real public IP.",
    speed:
      "Instant download ↓ / upload ↑ rate. Computed from the session counter byte delta (all uplink traffic of the modem, not a single device).",
    uptime: "Duration of the current connection session (since the last drop).",
  };

  const PANEL_CSS = `
  #mf-rf{position:fixed;z-index:2147483600;top:8px;right:8px;width:260px;background:#1b1f27;color:#e6e6e6;font:12px/1.4 system-ui,Arial,sans-serif;border:1px solid #333;border-radius:10px;box-shadow:0 6px 22px rgba(0,0,0,.45);user-select:none}
  #mf-rf .hd{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#252b36;border-radius:10px 10px 0 0;cursor:move}
  #mf-rf .hd b{font-size:12px;letter-spacing:.3px}
  #mf-rf .hd .x{cursor:pointer;opacity:.7;padding:0 4px}
  #mf-rf .bd{padding:10px}
  #mf-rf .bar{position:relative;height:20px;border-radius:5px;background:#2c3340;margin:6px 0;overflow:hidden}
  #mf-rf .bar>span{position:absolute;left:0;top:0;bottom:0;border-radius:5px;transition:width .3s,background .3s}
  #mf-rf .bar>em{position:absolute;left:8px;top:0;line-height:20px;font-style:normal;font-weight:600;text-shadow:0 1px 1px rgba(0,0,0,.6)}
  #mf-rf .kv{display:flex;justify-content:space-between;padding:2px 0;border-top:1px solid #2c3340}
  #mf-rf .kv span:last-child{color:#9fd0ff;font-weight:600}
  #mf-rf .row{display:flex;gap:6px;margin-top:8px}
  #mf-rf button{flex:1;background:#34507a;color:#fff;border:0;border-radius:6px;padding:7px 4px;cursor:pointer;font-size:11px}
  #mf-rf button:hover{background:#3f63a0}
  #mf-rf button.lk{background:#7a3434}
  #mf-rf .st{margin-top:6px;font-size:10px;opacity:.7;min-height:13px}
  #mf-rf .kv span:last-child a{color:#9fd0ff;text-decoration:none;border-bottom:1px dotted #9fd0ff}
  #mf-rf.min .bd{display:none}`;

  const PANEL_HTML = `
    <div class="hd"><b>MF286R RF</b><span class="x" title="Expand/Collapse">▾</span></div>
    <div class="bd">
      ${Object.entries(METRICS)
        .map(
          ([key, metric]) =>
            `<div class="bar" id="b-${key}" title="${metric.tip}"><span></span><em>${metric.label}</em></div>`,
        )
        .join("")}
      <div class="kv" title="${ROW_TIPS.speed}"><span>↓ / ↑</span><span id="v-speed">—</span></div>
      <div class="kv" title="${ROW_TIPS.mode}"><span>Mode</span><span id="v-mode">—</span></div>
      <div class="kv" title="${ROW_TIPS.band}"><span>CA / Band</span><span id="v-band">—</span></div>
      <div class="kv" title="${ROW_TIPS.cell}"><span>eNB / Cell</span><span id="v-cell">—</span></div>
      <div class="kv" title="${ROW_TIPS.uptime}"><span>Uptime</span><span id="v-up">—</span></div>
      <div class="kv" title="${ROW_TIPS.ip}"><span>WAN IP</span><span id="v-ip">—</span></div>
      <div class="row"><button id="bt-dns">DNS</button><button id="bt-rat" class="lk">4G-Lock</button></div>
      <div class="st" id="v-st"></div>
    </div>`;

  const MD5_SHIFTS = [
    [7, 12, 17, 22],
    [5, 9, 14, 20],
    [4, 11, 16, 23],
    [6, 10, 15, 21],
  ];
  const MD5_CONSTANTS = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501, 0x698098d8,
    0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
    0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87,
    0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039,
    0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
    0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
    0xeb86d391,
  ];
  const MD5_ROUNDS = [
    { mix: (b, c, d) => (b & c) | (~b & d), wordIndex: (i) => i },
    { mix: (b, c, d) => (b & d) | (c & ~d), wordIndex: (i) => (5 * i + 1) % 16 },
    { mix: (b, c, d) => b ^ c ^ d, wordIndex: (i) => (3 * i + 5) % 16 },
    { mix: (b, c, d) => c ^ (b | ~d), wordIndex: (i) => (7 * i) % 16 },
  ];
  // Only_LTE and NETWORK_auto are the values the firmware's config.js (AUTO_MODES_USER2) and net_select.js use.
  const BEARER_MODES = { lteOnly: "Only_LTE", auto: "NETWORK_auto" };

  let panel = null;
  // Throughput comes from the cumulative session byte counters, keyed on realtime_time so that a session reset or reconnect cannot produce a bogus spike.
  let previousCounters = null;
  let lteOnly = false;

  const log = (...args) => console.log("[MF286R RF Panel]", ...args);

  // Deliberately not strict UTF-8: each UTF-16 code unit is encoded on its own, so a surrogate pair becomes two
  // 3-byte sequences. That keeps the digest identical to the Joseph Myers MD5 this script has always signed with.
  function utf8Bytes(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push((code >> 6) | 0xc0, (code & 0x3f) | 0x80);
      else bytes.push((code >> 12) | 0xe0, ((code >> 6) & 0x3f) | 0x80, (code & 0x3f) | 0x80);
    }
    return bytes;
  }

  // The modem signs every set request with AD = md5(md5(wa_inner_version + cr_version) + RD).
  function md5(text) {
    const add = (x, y) => (x + y) | 0;
    const rotateLeft = (value, bits) => (value << bits) | (value >>> (32 - bits));

    const bytes = utf8Bytes(text.replace(/\r\n/g, "\n"));
    const wordCount = (((bytes.length + 8) >>> 6) + 1) * 16;
    const words = new Array(wordCount).fill(0);
    bytes.forEach((byte, index) => {
      words[index >> 2] |= byte << ((index % 4) * 8);
    });
    words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
    words[wordCount - 2] = bytes.length << 3;
    words[wordCount - 1] = bytes.length >>> 29;

    const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    for (let block = 0; block < wordCount; block += 16) {
      let [a, b, c, d] = state;
      for (let i = 0; i < 64; i++) {
        const round = i >> 4;
        const { mix, wordIndex } = MD5_ROUNDS[round];
        const sum = add(add(a, mix(b, c, d)), add(MD5_CONSTANTS[i], words[block + wordIndex(i % 16)]));
        [a, b, c, d] = [d, add(b, rotateLeft(sum, MD5_SHIFTS[round][i % 4])), b, c];
      }
      state[0] = add(state[0], a);
      state[1] = add(state[1], b);
      state[2] = add(state[2], c);
      state[3] = add(state[3], d);
    }

    return state
      .map((word) => [0, 8, 16, 24].map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, "0")).join(""))
      .join("");
  }

  async function getFields(fields) {
    const response = await fetch(`${ENDPOINTS.get}?isTest=false&multi_data=1&cmd=${encodeURIComponent(fields)}`, {
      credentials: "include",
    });
    return response.json();
  }

  async function authToken() {
    const versions = await getFields("wa_inner_version,cr_version,RD");
    return md5(md5((versions.wa_inner_version || "") + (versions.cr_version || "")) + (versions.RD || ""));
  }

  async function setFields(params) {
    params.isTest = "false";
    params.AD = await authToken();
    const body = Object.keys(params)
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join("&");
    const response = await fetch(ENDPOINTS.set, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return response.json().catch(() => ({}));
  }

  const isSuccess = (result) => result.result === "0" || result.result === "success";

  const find = (selector) => panel.querySelector(selector);

  function savePosition() {
    try {
      localStorage.setItem(
        POSITION_KEY,
        JSON.stringify({ top: panel.style.top, left: panel.style.left, min: panel.classList.contains("min") }),
      );
    } catch {
      // Without storage the panel only forgets its position.
    }
  }

  function restorePosition() {
    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || "{}");
      if (saved.top) {
        panel.style.top = saved.top;
        panel.style.left = saved.left;
        panel.style.right = "auto";
      }
      if (saved.min) panel.classList.add("min");
    } catch {
      // A missing or corrupt entry leaves the default position.
    }
  }

  function enableCollapseAndDrag() {
    const toggle = find(".x");
    toggle.onclick = (event) => {
      event.stopPropagation();
      panel.classList.toggle("min");
      savePosition();
    };

    let drag = null;
    find(".hd").addEventListener("mousedown", (event) => {
      if (event.target.classList.contains("x")) return;
      drag = { x: event.clientX, y: event.clientY, top: panel.offsetTop, left: panel.offsetLeft };
      event.preventDefault();
    });
    document.addEventListener("mousemove", (event) => {
      if (!drag) return;
      panel.style.top = `${drag.top + event.clientY - drag.y}px`;
      panel.style.left = `${drag.left + event.clientX - drag.x}px`;
      panel.style.right = "auto";
    });
    document.addEventListener("mouseup", () => {
      if (!drag) return;
      drag = null;
      savePosition();
    });
  }

  function setStatus(text, isError) {
    const status = find("#v-st");
    status.textContent = text || "";
    status.style.color = isError ? COLORS.error : "";
  }

  function colorFor(metric, value) {
    if (value >= metric.good) return COLORS.good;
    if (value >= metric.ok) return COLORS.ok;
    return COLORS.bad;
  }

  function drawBar(key, rawValue) {
    const metric = METRICS[key];
    const bar = find(`#b-${key}`);
    const fill = bar.firstElementChild;
    const label = bar.lastElementChild;
    // Global isNaN on purpose: it coerces the modem's string values, which Number.isNaN would not.
    if (rawValue === "" || rawValue == null || isNaN(rawValue)) {
      fill.style.width = "0";
      label.textContent = `${metric.label} —`;
      return;
    }
    const value = parseFloat(rawValue);
    const percent = Math.max(0, Math.min(100, ((value - metric.min) / (metric.max - metric.min)) * 100));
    fill.style.width = `${percent}%`;
    fill.style.background = colorFor(metric, value);
    label.textContent = `${metric.label} ${value} ${metric.unit}`;
  }

  const formatRate = (bitsPerSecond) =>
    bitsPerSecond >= 1e6 ? `${(bitsPerSecond / 1e6).toFixed(2)} Mbps` : `${(bitsPerSecond / 1e3).toFixed(0)} Kbps`;

  function formatDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  }

  function renderSpeedAndUptime(data) {
    const time = parseInt(data.realtime_time);
    const rx = parseInt(data.realtime_rx_bytes);
    const tx = parseInt(data.realtime_tx_bytes);
    find("#v-up").textContent = isNaN(time) ? "—" : formatDuration(time);

    const previous = previousCounters;
    if (previous && time > previous.time && rx >= previous.rx && tx >= previous.tx) {
      const elapsed = time - previous.time;
      const down = formatRate(((rx - previous.rx) * 8) / elapsed);
      const up = formatRate(((tx - previous.tx) * 8) / elapsed);
      find("#v-speed").textContent = `↓ ${down}  ↑ ${up}`;
    } else if (!previous || time < (previous.time || 0)) {
      find("#v-speed").textContent = "↓ —  ↑ —";
    }
    if (!isNaN(time) && !isNaN(rx) && !isNaN(tx)) previousCounters = { time, rx, tx };
  }

  function describeBands(data, carrierAggregation) {
    let bands = data.lte_ca_pcell_band ? `B${data.lte_ca_pcell_band}` : "—";
    if (data.lte_ca_pcell_bandwidth) bands += `@${data.lte_ca_pcell_bandwidth}MHz`;
    if (!carrierAggregation) return bands;
    // lte_ca_scell_band names one secondary carrier; with 3+ carriers only lte_ca_scell_info ("…,band,…;" per extra
    // carrier) lists them all.
    if (data.lte_ca_scell_band) return `${bands} +B${data.lte_ca_scell_band}`;
    if (!data.lte_ca_scell_info) return bands;
    const secondary = data.lte_ca_scell_info
      .replace(/;$/, "")
      .split(";")
      .map((carrier) => {
        const fields = carrier.split(",");
        return fields[2] ? `+B${fields[2]}` : "";
      })
      .join("");
    return `${bands} ${secondary}`;
  }

  function renderCell(data) {
    const cellElement = find("#v-cell");
    if (!data.Z_eNB_id) {
      cellElement.textContent = data.Z_CELL_ID || "—";
      return;
    }
    const enb = Math.trunc(data.Z_eNB_id / 256);
    const cell = data.Z_CELL_ID || data.Z_eNB_id % 256;
    if (!data.mcc || !data.mnc) {
      cellElement.textContent = `${enb} / ${cell}`;
      return;
    }
    // CellMapper resolves the provider from an unpadded MNC (Turk Telekom is 3, not 03). The eNB goes to the clipboard
    // on click so it can be pasted into CellMapper's search box.
    const mnc = String(data.mnc).replace(/^0+/, "") || String(data.mnc);
    let url = `https://www.cellmapper.net/map?MCC=${data.mcc}&MNC=${mnc}&type=LTE`;
    if (HOME.lat && HOME.lon) {
      url += `&latitude=${HOME.lat}&longitude=${HOME.lon}&zoom=${HOME.zoom || CONFIG.defaultMapZoom}`;
    }
    const homeNote = HOME.lat ? " (centred on your home area)" : "";
    cellElement.innerHTML = `<a href="${url}" target="_blank" rel="noopener" title="CellMapper Türk Telekom LTE map${homeNote} — eNB ${enb} copied to clipboard, paste it into the search box">${enb}</a> / ${cell}`;
    cellElement.firstElementChild.addEventListener("click", () => {
      try {
        navigator.clipboard.writeText(String(enb));
      } catch {
        // Clipboard access can be refused; the link still opens.
      }
    });
  }

  function render(data) {
    for (const key of Object.keys(METRICS)) drawBar(key, METRICS[key].pick(data));
    renderSpeedAndUptime(data);
    const carrierAggregation = data.wan_lte_ca === "ca_activated";
    find("#v-mode").textContent =
      (data.network_type || "—") + (data.network_provider ? ` · ${data.network_provider}` : "");
    find("#v-band").textContent = (carrierAggregation ? "🔗 " : "") + describeBands(data, carrierAggregation);
    renderCell(data);
    find("#v-ip").textContent = data.wan_ipaddr || "—";
  }

  async function poll() {
    if (document.hidden) return;
    try {
      render(await getFields(POLL_FIELDS));
      setStatus(`updated · ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      log("poll failed", error);
      setStatus("read error (are you logged in?)", true);
    }
  }

  // Mirrors the modem's own ROUTER_DNS_SETTING form.
  async function changeDns() {
    const input = prompt("DNS servers (comma-separated, e.g. 1.1.1.1,1.0.0.1). Type AUTO for the default.", "AUTO");
    if (input == null || input.trim() === "") return;
    try {
      setStatus("applying DNS…");
      let params;
      if (input.trim().toLowerCase() === "auto") {
        params = { goformId: "ROUTER_DNS_SETTING", dns_mode: "auto", prefer_dns_manual: "", standby_dns_manual: "" };
      } else {
        const [preferred, standby] = input.split(",");
        params = {
          goformId: "ROUTER_DNS_SETTING",
          dns_mode: "manual",
          prefer_dns_manual: (preferred || "").trim(),
          standby_dns_manual: (standby || "").trim(),
        };
      }
      const result = await setFields(params);
      const ok = isSuccess(result);
      setStatus(ok ? "DNS OK" : `DNS response: ${JSON.stringify(result)}`, !ok);
    } catch (error) {
      log("DNS change failed", error);
      setStatus("DNS error", true);
    }
  }

  function showLteLock() {
    const button = find("#bt-rat");
    button.textContent = lteOnly ? "Auto" : "4G-Lock";
    button.classList.toggle("lk", !lteOnly);
  }

  // The modem keeps its bearer preference across reloads, so the button starts from what the modem reports rather than assuming automatic mode; any other value leaves it on 4G-Lock.
  async function readLteLock() {
    try {
      const { net_select: mode } = await getFields("net_select");
      lteOnly = mode === BEARER_MODES.lteOnly;
      showLteLock();
    } catch (error) {
      log("reading net_select failed", error);
    }
  }

  async function toggleLteLock() {
    const target = lteOnly ? BEARER_MODES.auto : BEARER_MODES.lteOnly;
    const question = lteOnly
      ? "Switch network mode to AUTOMATIC? (brief disconnect)"
      : "Apply the 4G-only lock? (brief disconnect)";
    if (!confirm(question)) return;
    try {
      setStatus("changing mode…");
      const result = await setFields({ goformId: "SET_BEARER_PREFERENCE", BearerPreference: target });
      if (!isSuccess(result)) {
        setStatus(`mode response: ${JSON.stringify(result)}`, true);
        return;
      }
      lteOnly = !lteOnly;
      showLteLock();
      setStatus(lteOnly ? "4G-only locked" : "Automatic mode");
    } catch (error) {
      log("bearer change failed", error);
      setStatus("mode error", true);
    }
  }

  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);

  panel = document.createElement("div");
  panel.id = "mf-rf";
  panel.innerHTML = PANEL_HTML;
  document.body.appendChild(panel);

  restorePosition();
  enableCollapseAndDrag();
  find("#bt-dns").onclick = changeDns;
  find("#bt-rat").onclick = toggleLteLock;
  readLteLock();
  poll();
  setInterval(poll, CONFIG.pollMs);
})();
