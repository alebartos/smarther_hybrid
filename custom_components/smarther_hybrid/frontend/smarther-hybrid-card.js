/*
 * Smarther Hybrid card.
 *
 * Wraps Home Assistant's own thermostat card, so it looks and behaves
 * exactly the same, and adds two things just above the card features
 * (e.g. the mode buttons):
 *   - bottom left: humidity as a small dial like the thermostat's, with the
 *     percentage inside over a water drop (from `humidity_entity`, or the
 *     entity's current_humidity);
 *   - bottom right: a sync dot, green when every command is confirmed,
 *     orange when Netatmo accepted a command but has not reported it back
 *     yet, red while something is queued, in flight or refused, grey if
 *     unavailable.
 *
 * Optionally a button in the top left corner (`button`: icon, name,
 * tap_action, hold_action) runs standard Home Assistant actions, e.g.
 * navigate to another dashboard view.
 *
 * Every other option is passed to the thermostat card unchanged.
 */

const CARD_TYPE = "smarther-hybrid-card";
const EDITOR_TYPE = "smarther-hybrid-card-editor";

// Options handled here and never passed to the thermostat card.
const OWN_KEYS = ["humidity_entity", "button"];
const DEFAULT_BUTTON_ICON = "mdi:gesture-tap-button";
const HOLD_MS = 500;

const splitConfig = (config) => {
  const own = {};
  const inner = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "type") continue;
    (OWN_KEYS.includes(key) ? own : inner)[key] = value;
  }
  return { own, inner: { ...inner, type: "thermostat" } };
};

const textFor = (hass) => {
  const lang = ((hass && hass.language) || "en").split("-")[0];
  return TEXT[lang] || TEXT.en;
};

const TEXT = {
  it: {
    synced: "Sincronizzato: tutti i comandi confermati",
    accepted: "Accettato da Netatmo, in attesa di conferma",
    pending: "Comando in coda o non confermato",
    unavailable: "Termostato non disponibile",
    temperature: "temperatura",
    hvac: "modalità",
    preset: "preset",
    missingEntity: "Specifica un'entità (entity)",
    humidityEntity: "Sensore umidità (facoltativo)",
    humidityHelp: "Se vuoto, usa l'umidità dell'entità termostato.",
    button: "Pulsante (in alto a sinistra)",
    icon: "Icona",
    name: "Nome (suggerimento)",
    tap_action: "Azione al tocco",
    hold_action: "Azione alla pressione prolungata",
    humidity: "Umidità",
  },
  en: {
    synced: "Synced: every command confirmed",
    accepted: "Accepted by Netatmo, waiting for confirmation",
    pending: "Command queued or not confirmed",
    unavailable: "Thermostat unavailable",
    temperature: "temperature",
    hvac: "mode",
    preset: "preset",
    missingEntity: "Please define an entity",
    humidityEntity: "Humidity sensor (optional)",
    humidityHelp: "When empty, the thermostat entity's humidity is used.",
    button: "Button (top left)",
    icon: "Icon",
    name: "Name (tooltip)",
    tap_action: "Tap action",
    hold_action: "Hold action",
    humidity: "Humidity",
  },
};

// Humidity dial: a 270° arc open at the bottom, like the thermostat's.
const RING_R = 24;
const RING_C = 2 * Math.PI * RING_R;
const RING_ARC = RING_C * 0.75;

const STYLE = `
  :host { display: block; height: 100%; }
  .wrap { position: relative; height: 100%; }
  .wrap > :first-child { height: 100%; }
  .action {
    position: absolute;
    top: 0;
    inset-inline-start: 0;
    width: 48px;
    height: 48px;
    padding: 12px;
    border: none;
    border-radius: 24px;
    background: none;
    color: var(--secondary-text-color);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .action[hidden] { display: none; }
  .action:hover { background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06); }
  .action:focus-visible { outline: 2px solid var(--primary-color); }
  .action ha-icon { --mdc-icon-size: 24px; display: block; }
  .overlay {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    pointer-events: none;
    color: var(--secondary-text-color);
    font-size: 14px;
    line-height: 20px;
  }
  .humidity {
    position: relative;
    width: 56px;
    height: 56px;
    display: grid;
    place-items: center;
  }
  .humidity[hidden] { display: none; }
  .humidity svg { position: absolute; inset: 0; overflow: visible; }
  .humidity .track,
  .humidity .arc {
    fill: none;
    stroke-width: 4;
    stroke-linecap: round;
  }
  .humidity .track { stroke: var(--disabled-color, #bdbdbd); opacity: 0.35; }
  .humidity .arc {
    stroke: var(--smarther-humidity-color, #2196f3);
    transition: stroke-dasharray 0.6s ease;
  }
  .humidity ha-icon {
    position: absolute;
    --mdc-icon-size: 30px;
    color: var(--smarther-humidity-color, #2196f3);
    opacity: 0.18;
  }
  .humidity .value {
    position: relative;
    color: var(--primary-text-color);
    font-size: 14px;
    font-weight: 500;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-left: auto;
    pointer-events: auto;
    background: var(--disabled-color, #bdbdbd);
  }
  .dot.synced { background: var(--success-color, #43a047); }
  .dot.accepted { background: var(--warning-color, #ffa600); }
  .dot.pending {
    background: var(--error-color, #db4437);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse { 50% { opacity: 0.35; } }
  @media (prefers-reduced-motion: reduce) { .dot.pending { animation: none; } }
`;

let helpersPromise;
// The card may start before Home Assistant exposes its helpers: wait for
// them (up to 10 s) instead of giving up.
const loadHelpers = async () => {
  for (let i = 0; i < 100 && !window.loadCardHelpers; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!window.loadCardHelpers) return undefined;
  if (!helpersPromise) helpersPromise = window.loadCardHelpers();
  return helpersPromise;
};

class SmartherHybridCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement(EDITOR_TYPE);
  }

  static getStubConfig(hass) {
    const entity =
      Object.keys(hass.states).find(
        (id) =>
          id.startsWith("climate.") &&
          "hold_active" in hass.states[id].attributes
      ) || "";
    return {
      entity,
      features: [
        { type: "climate-hvac-modes", hvac_modes: ["auto", "heat", "off"] },
        { type: "climate-preset-modes", style: "dropdown" },
      ],
    };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error(TEXT.en.missingEntity);
    }
    this._config = config;
    this._render();
    this._updateButton();
    this._buildCard();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._card) this._card.hass = hass;
    this._update();
  }

  getCardSize() {
    return this._card && this._card.getCardSize ? this._card.getCardSize() : 7;
  }

  getGridOptions() {
    return this._card && this._card.getGridOptions
      ? this._card.getGridOptions()
      : { columns: 12, rows: "auto", min_columns: 6 };
  }

  getLayoutOptions() {
    return this._card && this._card.getLayoutOptions
      ? this._card.getLayoutOptions()
      : {};
  }

  connectedCallback() {
    if (!this._resize && window.ResizeObserver) {
      this._resize = new ResizeObserver(() => this._position());
      this._resize.observe(this);
    }
  }

  disconnectedCallback() {
    if (this._resize) {
      this._resize.disconnect();
      this._resize = undefined;
    }
  }

  _t(key) {
    return textFor(this._hass)[key];
  }

  _render() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="wrap">
        <div class="card"></div>
        <button class="action" type="button" hidden><ha-icon></ha-icon></button>
        <div class="overlay">
          <span class="humidity" role="img" hidden>
            <svg viewBox="0 0 56 56" aria-hidden="true">
              <circle class="track" cx="28" cy="28" r="${RING_R}"
                transform="rotate(135 28 28)"
                stroke-dasharray="${RING_ARC} ${RING_C}"></circle>
              <circle class="arc" cx="28" cy="28" r="${RING_R}"
                transform="rotate(135 28 28)"
                stroke-dasharray="0 ${RING_C}"></circle>
            </svg>
            <ha-icon icon="mdi:water"></ha-icon>
            <span class="value"></span>
          </span>
          <span class="dot" role="img"></span>
        </div>
      </div>`;
    this._slot = root.querySelector(".card");
    this._overlay = root.querySelector(".overlay");
    this._humidity = root.querySelector(".humidity");
    this._humidityValue = root.querySelector(".humidity .value");
    this._humidityArc = root.querySelector(".humidity .arc");
    this._dot = root.querySelector(".dot");
    this._button = root.querySelector(".action");
    this._buttonIcon = root.querySelector(".action ha-icon");
    this._bindButton();
  }

  _bindButton() {
    let timer;
    let held = false;
    const clear = () => clearTimeout(timer);
    this._button.addEventListener("pointerdown", () => {
      held = false;
      timer = setTimeout(() => {
        held = true;
        this._runAction("hold");
      }, HOLD_MS);
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) {
      this._button.addEventListener(ev, clear);
    }
    this._button.addEventListener("click", () => {
      if (held) {
        held = false;
        return;
      }
      this._runAction("tap");
    });
    this._button.addEventListener("contextmenu", (ev) => ev.preventDefault());
  }

  _runAction(action) {
    const button = this._config.button;
    if (!button || (action === "hold" && !button.hold_action)) return;
    // Handled by Home Assistant like any card action (navigate, url, …).
    const ev = new Event("hass-action", { bubbles: true, composed: true });
    ev.detail = {
      config: {
        entity: this._config.entity,
        tap_action: button.tap_action || { action: "more-info" },
        hold_action: button.hold_action,
      },
      action,
    };
    this.dispatchEvent(ev);
  }

  _updateButton() {
    const button = this._config.button;
    const show = !!(button && (button.icon || button.tap_action || button.hold_action));
    this._button.hidden = !show;
    if (!show) return;
    this._buttonIcon.setAttribute("icon", button.icon || DEFAULT_BUTTON_ICON);
    const label = button.name || "";
    this._button.title = label;
    if (label) this._button.setAttribute("aria-label", label);
    else this._button.removeAttribute("aria-label");
  }

  async _buildCard() {
    const { inner } = splitConfig(this._config);
    this._buildId = (this._buildId || 0) + 1;
    const build = this._buildId;
    const helpers = await loadHelpers();
    if (!helpers || build !== this._buildId) return;

    const card = helpers.createCardElement(inner);
    if (this._hass) card.hass = this._hass;
    this._slot.replaceChildren(card);
    this._card = card;

    if (card.updateComplete) await card.updateComplete;
    this._position();
    this._update();
  }

  _position() {
    if (!this._card || !this._overlay) return;
    const features =
      this._card.shadowRoot &&
      this._card.shadowRoot.querySelector("hui-card-features");
    if (!features || !features.offsetHeight) {
      this._overlay.style.bottom = "12px";
      return;
    }
    const host = this.getBoundingClientRect();
    const top = features.getBoundingClientRect().top;
    this._overlay.style.bottom = `${Math.max(host.bottom - top + 4, 12)}px`;
  }

  _update() {
    if (!this._hass || !this._config || !this._dot) return;
    const stateObj = this._hass.states[this._config.entity];

    // Humidity: explicit sensor first, then the climate entity.
    let humidity;
    if (this._config.humidity_entity) {
      const h = this._hass.states[this._config.humidity_entity];
      if (h && !isNaN(parseFloat(h.state))) humidity = parseFloat(h.state);
    } else if (stateObj && stateObj.attributes.current_humidity != null) {
      humidity = Number(stateObj.attributes.current_humidity);
    }
    this._humidity.hidden = humidity === undefined;
    if (humidity !== undefined) {
      const pct = Math.min(Math.max(humidity, 0), 100);
      const label = `${Math.round(humidity)}%`;
      this._humidityValue.textContent = label;
      this._humidityArc.setAttribute(
        "stroke-dasharray",
        `${(RING_ARC * pct) / 100} ${RING_C}`
      );
      this._humidity.setAttribute("aria-label", `${this._t("humidity")} ${label}`);
    }

    // Sync dot.
    let cls = "";
    let title = this._t("unavailable");
    if (stateObj && stateObj.state !== "unavailable" && "synced" in stateObj.attributes) {
      const attrs = stateObj.attributes;
      cls = attrs.sync_state || (attrs.synced ? "synced" : "pending");
      title = this._t(cls);
      if (cls !== "synced") {
        const what = (attrs.pending || []).map((k) => this._t(k) || k);
        title = `${title}: ${what.join(", ")}`;
      }
    }
    this._dot.className = `dot ${cls}`;
    this._dot.title = title;
    this._dot.setAttribute("aria-label", title);

    // Features can appear or change size after a state update.
    requestAnimationFrame(() => this._position());
  }
}

/*
 * Visual editor: Home Assistant's own thermostat card editor (entity, name,
 * features…) plus a humidity sensor picker. The thermostat editor only
 * accepts its own options, so it gets the config without ours and its
 * changes are merged back.
 */
const editorSchema = (text) => [
  {
    name: "humidity_entity",
    selector: { entity: { domain: "sensor", device_class: "humidity" } },
  },
  {
    name: "button",
    type: "expandable",
    title: text.button,
    icon: DEFAULT_BUTTON_ICON,
    schema: [
      { name: "icon", selector: { icon: {} } },
      { name: "name", selector: { text: {} } },
      { name: "tap_action", selector: { ui_action: {} } },
      { name: "hold_action", selector: { ui_action: {} } },
    ],
  },
];

class SmartherHybridCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._build().then(() => this._sync());
  }

  set hass(hass) {
    this._hass = hass;
    if (this._native) this._native.hass = hass;
    if (this._form) {
      const text = textFor(hass);
      this._form.hass = hass;
      this._form.schema = editorSchema(text);
      this._form.computeLabel = (field) =>
        field.name === "humidity_entity" ? text.humidityEntity : text[field.name];
      this._form.computeHelper = (field) =>
        field.name === "humidity_entity" ? text.humidityHelp : undefined;
    }
  }

  async _build() {
    if (this._building) return this._building;
    this._building = (async () => {
      // Make sure the thermostat card (and its editor) is loaded.
      const helpers = await loadHelpers();
      if (helpers && !customElements.get("hui-thermostat-card")) {
        helpers.createCardElement({ type: "thermostat", entity: this._config.entity });
      }
      await customElements.whenDefined("hui-thermostat-card");
      this._native = await customElements
        .get("hui-thermostat-card")
        .getConfigElement();
      this._native.addEventListener("config-changed", (ev) => {
        ev.stopPropagation();
        const { inner } = splitConfig(ev.detail.config);
        const { own } = splitConfig(this._config);
        delete inner.type;
        this._emit({ type: `custom:${CARD_TYPE}`, ...inner, ...own });
      });

      this._form = document.createElement("ha-form");
      this._form.schema = editorSchema(textFor(this._hass));
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const config = { ...this._config };
        const { humidity_entity, button } = ev.detail.value;
        if (humidity_entity) config.humidity_entity = humidity_entity;
        else delete config.humidity_entity;
        const cleaned = Object.fromEntries(
          Object.entries(button || {}).filter(([, v]) => v !== "" && v != null)
        );
        if (Object.keys(cleaned).length) config.button = cleaned;
        else delete config.button;
        this._emit(config);
      });

      const spacer = document.createElement("div");
      spacer.style.height = "16px";
      this.replaceChildren(this._native, spacer, this._form);
      if (this._hass) this.hass = this._hass;
    })();
    return this._building;
  }

  _sync() {
    if (!this._native || !this._config) return;
    const { own, inner } = splitConfig(this._config);
    this._native.setConfig(inner);
    this._form.data = {
      humidity_entity: own.humidity_entity || "",
      button: own.button || {},
    };
  }

  _emit(config) {
    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      })
    );
  }
}

if (!customElements.get(EDITOR_TYPE)) {
  customElements.define(EDITOR_TYPE, SmartherHybridCardEditor);
}

if (!customElements.get(CARD_TYPE)) {
  customElements.define(CARD_TYPE, SmartherHybridCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: CARD_TYPE,
    name: "Smarther Hybrid",
    description:
      "Thermostat card with humidity and a sync dot for Smarther Hybrid.",
    preview: true,
  });
}

/*
 * Smarther Schedule card (read only for now).
 *
 * Shows the Netatmo heating schedules kept by the Netatmo integration: a
 * week view (one bar per day, coloured by zone from cool blue to warm
 * orange), the zones with their temperatures and a marker for now.
 * Data comes from the `smarther_hybrid/schedules` websocket command.
 */

const SCHEDULE_CARD_TYPE = "smarther-schedule-card";
const SCHEDULE_EDITOR_TYPE = "smarther-schedule-card-editor";
const WEEK_MINUTES = 7 * 24 * 60;
const DAY_MINUTES = 24 * 60;
const SCHEDULE_REFRESH_MS = 60 * 1000;
const COOL_RGB = [43, 154, 249];
const WARM_RGB = [255, 129, 0];

const SCHEDULE_TEXT = {
  it: {
    title: "Programma riscaldamento",
    active: "attivo",
    days: ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"],
    empty: "Nessun programma di riscaldamento Netatmo trovato.",
    noNetatmo: "Integrazione Netatmo non trovata o non ancora caricata.",
    error: "Impossibile leggere i programmi",
    noTemp: "—",
    cardTitle: "Titolo",
    activate: "Attiva questo programma",
    activating: "Attivazione…",
    activateError: "Attivazione non riuscita",
  },
  en: {
    title: "Heating schedule",
    active: "active",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    empty: "No Netatmo heating schedule found.",
    noNetatmo: "Netatmo integration not found or not loaded yet.",
    error: "Could not read the schedules",
    noTemp: "—",
    cardTitle: "Title",
    activate: "Make this schedule active",
    activating: "Activating…",
    activateError: "Could not activate",
  },
};

const scheduleText = (hass) => {
  const lang = ((hass && hass.language) || "en").split("-")[0];
  return SCHEDULE_TEXT[lang] || SCHEDULE_TEXT.en;
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const formatMinutes = (minutes) => {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const formatTemp = (value) =>
  value == null ? null : `${Number(value).toFixed(1).replace(/\.0$/, "")}°`;

// Zone temperature: the single room's, or the warmest when several rooms.
const zoneTemp = (zone) => {
  const temps = (zone.rooms || [])
    .map((r) => r.temperature)
    .filter((t) => t != null);
  return temps.length ? Math.max(...temps) : null;
};

// Week split into per-day segments [{day, start, end, zone}] (minutes in day).
const daySegments = (timetable) => {
  if (!timetable.length) return [];
  const spans = timetable.map((entry, i) => ({
    start: entry.m_offset,
    end: i + 1 < timetable.length ? timetable[i + 1].m_offset : WEEK_MINUTES,
    zone: entry.zone_id,
  }));
  // Before the first entry the week continues the last zone.
  if (timetable[0].m_offset > 0) {
    spans.unshift({
      start: 0,
      end: timetable[0].m_offset,
      zone: timetable[timetable.length - 1].zone_id,
    });
  }
  const segments = [];
  for (let day = 0; day < 7; day++) {
    const dayStart = day * DAY_MINUTES;
    const dayEnd = dayStart + DAY_MINUTES;
    for (const span of spans) {
      const start = Math.max(span.start, dayStart);
      const end = Math.min(span.end, dayEnd);
      if (end > start) {
        segments.push({ day, start: start - dayStart, end: end - dayStart, zone: span.zone });
      }
    }
  }
  return segments;
};

const SCHEDULE_STYLE = `
  ha-card { padding: 16px; }
  .header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .title {
    flex: 1;
    font-size: var(--ha-font-size-l, 18px);
    font-weight: var(--ha-font-weight-medium, 500);
    color: var(--primary-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .refresh {
    border: none;
    background: none;
    color: var(--secondary-text-color);
    cursor: pointer;
    border-radius: 50%;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
  }
  .refresh:hover { background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06); }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border-radius: 16px;
    border: 1px solid var(--divider-color);
    background: none;
    color: var(--primary-text-color);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }
  .chip.current {
    background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.15);
    border-color: transparent;
  }
  .chip .badge { font-size: 12px; color: var(--secondary-text-color); }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-bottom: 16px; }
  .zone { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; color: var(--primary-text-color); }
  .swatch { width: 12px; height: 12px; border-radius: 4px; flex: none; }
  .zone .temp { color: var(--secondary-text-color); }
  .week { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; }
  .day { font-size: 13px; color: var(--secondary-text-color); }
  .day.today { color: var(--primary-text-color); font-weight: 500; }
  .bar {
    position: relative;
    height: 22px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--secondary-background-color, rgba(127, 127, 127, 0.15));
  }
  .seg { position: absolute; top: 0; bottom: 0; }
  .seg + .seg { box-shadow: inset 1px 0 0 var(--card-background-color, #fff); }
  .now {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    margin-left: -1px;
    background: var(--primary-text-color);
    border-radius: 1px;
  }
  .axis {
    grid-column: 2;
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--secondary-text-color);
  }
  .message { color: var(--secondary-text-color); padding: 8px 0; }
  .message.error { color: var(--error-color, #db4437); }
  .activate {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 16px;
    margin-bottom: 16px;
    border: none;
    border-radius: 18px;
    background: var(--primary-color);
    color: var(--text-primary-color, #fff);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }
  .activate[disabled] { opacity: 0.6; cursor: default; }
`;

class SmartherScheduleCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement(SCHEDULE_EDITOR_TYPE);
  }

  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    this._config = config || {};
    this._shown = this._config.schedule || undefined;
    this._draw();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._load();
  }

  connectedCallback() {
    this._timer = setInterval(() => this._load(), SCHEDULE_REFRESH_MS);
    if (this._hass) this._load();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  async _load() {
    if (!this._hass) return;
    try {
      const result = await this._hass.callWS({ type: "smarther_hybrid/schedules" });
      this._homes = result.homes || [];
      this._netatmoFound = result.netatmo_found !== false;
      this._error = undefined;
    } catch (err) {
      this._error = err && err.message ? err.message : String(err);
    }
    this._draw();
  }

  _home() {
    const homes = this._homes || [];
    const wanted = this._config.home;
    return (
      homes.find((h) => wanted && (h.id === wanted || h.name === wanted)) ||
      homes.find((h) => h.schedules.length) ||
      homes[0]
    );
  }

  _draw() {
    if (!this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const t = scheduleText(this._hass);
    const home = this._homes && this._home();
    const schedules = home ? home.schedules : [];
    const schedule =
      schedules.find((s) => s.id === this._shown || s.name === this._shown) ||
      schedules.find((s) => s.selected) ||
      schedules[0];

    let body;
    if (this._error) {
      body = `<div class="message">${escapeHtml(t.error)}: ${escapeHtml(this._error)}</div>`;
    } else if (!this._homes) {
      body = "";
    } else if (!this._netatmoFound) {
      body = `<div class="message">${escapeHtml(t.noNetatmo)}</div>`;
    } else if (!schedule) {
      body = `<div class="message">${escapeHtml(t.empty)}</div>`;
    } else {
      body =
        this._chips(schedules, schedule, t) +
        this._activate(schedule, t) +
        this._legend(schedule, t) +
        this._week(schedule, t);
    }

    const title = this._config.title || t.title;
    this.shadowRoot.innerHTML = `
      <style>${SCHEDULE_STYLE}</style>
      <ha-card>
        <div class="header">
          <div class="title">${escapeHtml(title)}</div>
          <button class="refresh" type="button" aria-label="refresh">
            <ha-icon icon="mdi:refresh"></ha-icon>
          </button>
        </div>
        ${body}
      </ha-card>`;
    this.shadowRoot.querySelector(".refresh").addEventListener("click", () => this._load());
    const activate = this.shadowRoot.querySelector(".activate");
    if (activate) {
      activate.addEventListener("click", () => this._switch(home.id, schedule.id));
    }
    this.shadowRoot.querySelectorAll(".chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        this._shown = chip.dataset.id;
        this._draw();
      })
    );
  }

  _activate(schedule, t) {
    const error = this._switchError
      ? `<div class="message error">${escapeHtml(t.activateError)}: ${escapeHtml(this._switchError)}</div>`
      : "";
    if (schedule.selected) return error;
    const busy = this._switching === schedule.id;
    return `
      <button class="activate" type="button" ${busy ? "disabled" : ""}>
        <ha-icon icon="mdi:calendar-check" style="--mdc-icon-size:18px"></ha-icon>
        ${escapeHtml(busy ? t.activating : t.activate)}
      </button>${error}`;
  }

  async _switch(homeId, scheduleId) {
    this._switching = scheduleId;
    this._switchError = undefined;
    this._draw();
    try {
      const result = await this._hass.callWS({
        type: "smarther_hybrid/switch_schedule",
        home_id: homeId,
        schedule_id: scheduleId,
      });
      this._homes = result.homes || this._homes;
    } catch (err) {
      this._switchError = err && err.message ? err.message : String(err);
    }
    this._switching = undefined;
    this._draw();
  }

  _chips(schedules, current, t) {
    if (schedules.length < 2) return "";
    const chips = schedules
      .map(
        (s) => `
        <button class="chip ${s.id === current.id ? "current" : ""}" type="button" data-id="${escapeHtml(s.id)}">
          ${s.selected ? '<ha-icon icon="mdi:check" style="--mdc-icon-size:16px"></ha-icon>' : ""}
          ${escapeHtml(s.name)}
          ${s.selected ? `<span class="badge">${escapeHtml(t.active)}</span>` : ""}
        </button>`
      )
      .join("");
    return `<div class="chips">${chips}</div>`;
  }

  _zoneColors(schedule) {
    const temps = schedule.zones.map(zoneTemp).filter((v) => v != null);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const colors = {};
    for (const zone of schedule.zones) {
      const temp = zoneTemp(zone);
      if (temp == null) {
        colors[zone.id] = "var(--disabled-color, #bdbdbd)";
        continue;
      }
      const k = max > min ? (temp - min) / (max - min) : 1;
      const rgb = COOL_RGB.map((c, i) => Math.round(c + (WARM_RGB[i] - c) * k));
      colors[zone.id] = `rgb(${rgb.join(",")})`;
    }
    return colors;
  }

  _legend(schedule, t) {
    const colors = this._zoneColors(schedule);
    const zones = schedule.zones
      .map((zone) => {
        const temp = formatTemp(zoneTemp(zone)) || t.noTemp;
        return `
          <span class="zone">
            <span class="swatch" style="background:${colors[zone.id]}"></span>
            ${escapeHtml(zone.name || zone.id)}
            <span class="temp">${escapeHtml(temp)}</span>
          </span>`;
      })
      .join("");
    return `<div class="legend">${zones}</div>`;
  }

  _week(schedule, t) {
    const colors = this._zoneColors(schedule);
    const names = Object.fromEntries(schedule.zones.map((z) => [z.id, z.name || z.id]));
    const segments = daySegments(schedule.timetable);
    const now = new Date();
    const today = (now.getDay() + 6) % 7;
    const nowLeft = ((now.getHours() * 60 + now.getMinutes()) / DAY_MINUTES) * 100;

    let rows = "";
    for (let day = 0; day < 7; day++) {
      const segs = segments
        .filter((s) => s.day === day)
        .map((s) => {
          const left = (s.start / DAY_MINUTES) * 100;
          const width = ((s.end - s.start) / DAY_MINUTES) * 100;
          const tip = `${names[s.zone] || s.zone} · ${formatMinutes(s.start)}–${formatMinutes(s.end)}`;
          return `<div class="seg" title="${escapeHtml(tip)}" style="left:${left}%;width:${width}%;background:${colors[s.zone] || "var(--disabled-color)"}"></div>`;
        })
        .join("");
      const marker = day === today ? `<div class="now" style="left:${nowLeft}%"></div>` : "";
      rows += `
        <div class="day ${day === today ? "today" : ""}">${escapeHtml(t.days[day])}</div>
        <div class="bar">${segs}${marker}</div>`;
    }
    const axis = ["0", "6", "12", "18", "24"].map((h) => `<span>${h}</span>`).join("");
    return `<div class="week">${rows}<div class="axis">${axis}</div></div>`;
  }
}

class SmartherScheduleCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.schema = [{ name: "title", selector: { text: {} } }];
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const config = { ...this._config, ...ev.detail.value };
        if (!config.title) delete config.title;
        this._config = config;
        this.dispatchEvent(
          new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })
        );
      });
      this.replaceChildren(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { title: this._config.title || "" };
    this._form.computeLabel = () => scheduleText(this._hass).cardTitle;
  }
}

if (!customElements.get(SCHEDULE_EDITOR_TYPE)) {
  customElements.define(SCHEDULE_EDITOR_TYPE, SmartherScheduleCardEditor);
}

if (!customElements.get(SCHEDULE_CARD_TYPE)) {
  customElements.define(SCHEDULE_CARD_TYPE, SmartherScheduleCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: SCHEDULE_CARD_TYPE,
    name: "Smarther Schedule",
    description: "Week view of the Netatmo heating schedules.",
    preview: true,
  });
}
