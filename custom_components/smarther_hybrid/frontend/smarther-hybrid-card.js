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
const OWN_KEYS = ["humidity_entity", "button", "show_sync"];
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
    show_sync: "Mostra pallino di sincronizzazione",
    showSyncHelp: "Solo per le entità Smarther Hybrid; con altri termostati non compare.",
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
    show_sync: "Show sync dot",
    showSyncHelp: "Only for Smarther Hybrid entities; hidden for other thermostats.",
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
    width: var(--smarther-humidity-size, 56px);
    height: var(--smarther-humidity-size, 56px);
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
    --mdc-icon-size: calc(var(--smarther-humidity-size, 56px) * 0.54);
    color: var(--smarther-humidity-color, #2196f3);
    opacity: 0.18;
  }
  .humidity .value {
    position: relative;
    color: var(--primary-text-color);
    font-size: calc(var(--smarther-humidity-size, 56px) * 0.25);
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
  .dot[hidden] { display: none; }
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
    if (this._card && this._card.getGridOptions) return this._card.getGridOptions();
    // The thermostat card is created asynchronously: until then answer like
    // it would (same formula), or the grid gives too little room and the
    // cards below overlap the features.
    const features = (this._config && this._config.features) || [];
    const extra = Math.ceil((features.length * 2) / 3);
    return { columns: 12, rows: 5 + extra, min_columns: 6, min_rows: 2 + extra };
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
    if (!this._overlay) return;
    // The dial shrinks with the card: so does the humidity ring, or it would
    // touch the end of the dial's arc on narrow cards.
    const width = this.getBoundingClientRect().width;
    if (width) {
      const size = Math.round(Math.min(56, Math.max(38, width * 0.115)));
      this._overlay.style.setProperty("--smarther-humidity-size", `${size}px`);
      this._overlay.style.left = this._overlay.style.right = `${size < 48 ? 10 : 16}px`;
    }
    if (!this._card) return;
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

    // Sync dot: only for Smarther Hybrid entities, unless turned off.
    const hasSync = !!(stateObj && "synced" in stateObj.attributes);
    this._dot.hidden = this._config.show_sync === false || (stateObj && !hasSync);
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
  { name: "show_sync", selector: { boolean: {} } },
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
        ({ humidity_entity: text.humidityHelp, show_sync: text.showSyncHelp })[field.name];
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
        const { humidity_entity, button, show_sync } = ev.detail.value;
        if (humidity_entity) config.humidity_entity = humidity_entity;
        else delete config.humidity_entity;
        // Shown by default: only store it when turned off.
        if (show_sync === false) config.show_sync = false;
        else delete config.show_sync;
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
      show_sync: own.show_sync !== false,
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
const SLIDER_STEP = 15;
// Below this card width the open day is drawn on two rows (00–12, 12–24).
const SPLIT_DAY_WIDTH = 500;
const COOL_RGB = [43, 154, 249];
const WARM_RGB = [255, 129, 0];

const SCHEDULE_TEXT = {
  it: {
    title: "Programma riscaldamento",
    active: "attivo",
    days: ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"],
    dayNames: ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"],
    empty: "Nessun programma di riscaldamento Netatmo trovato.",
    noNetatmo: "Integrazione Netatmo non trovata o non ancora caricata.",
    error: "Impossibile leggere i programmi",
    noTemp: "—",
    cardTitle: "Titolo",
    activate: "Attiva questo programma",
    activating: "Attivazione…",
    activateError: "Attivazione non riuscita",
    edit: "Modifica",
    cancel: "Annulla",
    save: "Salva",
    saving: "Salvataggio…",
    saveError: "Salvataggio non riuscito",
    editHint: "Tocca un giorno per modificarne le fasce. Salva riscrive il programma su Netatmo (prima viene fatta una copia di backup).",
    addSlot: "Aggiungi fascia",
    remove: "Rimuovi",
    copyTo: "Copia su",
    weekdays: "Lun–Ven",
    weekend: "Sab–Dom",
    allDays: "Tutti i giorni",
    restore: "Ripristina versione precedente",
    restoreConfirm: "Ripristinare la versione del programma precedente all'ultimo salvataggio?",
    restoreError: "Ripristino non riuscito",
    badTimes: "Ogni fascia deve iniziare dopo la precedente.",
    preciseTimes: "Orari precisi",
    selected: "Fascia selezionata",
    split: "Dividi",
    dragHint: "Trascina i confini (passi di 15 minuti) e tocca una fascia per cambiarne la zona.",
  },
  en: {
    title: "Heating schedule",
    active: "active",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    dayNames: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    empty: "No Netatmo heating schedule found.",
    noNetatmo: "Netatmo integration not found or not loaded yet.",
    error: "Could not read the schedules",
    noTemp: "—",
    cardTitle: "Title",
    activate: "Make this schedule active",
    activating: "Activating…",
    activateError: "Could not activate",
    edit: "Edit",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    saveError: "Could not save",
    editHint: "Tap a day to edit its time slots. Save rewrites the schedule on Netatmo (a backup is kept first).",
    addSlot: "Add slot",
    remove: "Remove",
    copyTo: "Copy to",
    weekdays: "Mon–Fri",
    weekend: "Sat–Sun",
    allDays: "Every day",
    restore: "Restore previous version",
    restoreConfirm: "Restore the version saved before the last change?",
    restoreError: "Could not restore",
    badTimes: "Each slot must start after the previous one.",
    preciseTimes: "Exact times",
    selected: "Selected slot",
    split: "Split",
    dragHint: "Drag the boundaries (15-minute steps) and tap a slot to change its zone.",
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

const parseMinutes = (value) => {
  const [h, m] = String(value).split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};

const formatTemp = (value) =>
  value == null ? null : `${Number(value).toFixed(1).replace(/\.0$/, "")}°`;

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

// Per-day slots [{start, zone}] (first one at 00:00), from a timetable.
const daySlots = (timetable) => {
  const days = [[], [], [], [], [], [], []];
  for (const seg of daySegments(timetable)) {
    const slots = days[seg.day];
    if (!slots.length || slots[slots.length - 1].zone !== seg.zone) {
      slots.push({ start: seg.start, zone: seg.zone });
    }
  }
  return days;
};

// Timetable [{m_offset, zone_id}] from per-day slots; repeats are dropped.
const timetableFromDays = (days) => {
  const timetable = [];
  days.forEach((slots, day) =>
    slots.forEach((slot) => {
      const last = timetable[timetable.length - 1];
      if (!last || last.zone_id !== slot.zone) {
        timetable.push({ m_offset: day * DAY_MINUTES + slot.start, zone_id: slot.zone });
      }
    })
  );
  return timetable;
};

const sameZone = (a, b) => String(a) === String(b);

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
  .icon-btn {
    border: none;
    background: none;
    color: var(--secondary-text-color);
    cursor: pointer;
    border-radius: 50%;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    flex: none;
  }
  .icon-btn:hover { background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06); }
  .icon-btn[disabled] { opacity: 0.4; cursor: default; }
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
  .chip[disabled] { opacity: 0.5; cursor: default; }
  .chip .badge { font-size: 12px; color: var(--secondary-text-color); }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 16px;
    border-radius: 18px;
    border: none;
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    background: none;
    color: var(--primary-color);
  }
  .btn.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .btn.outline { border: 1px solid var(--divider-color); }
  .btn[disabled] { opacity: 0.6; cursor: default; }
  .activate { margin-bottom: 16px; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-bottom: 16px; }
  .zone { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; color: var(--primary-text-color); }
  .swatch { width: 12px; height: 12px; border-radius: 4px; flex: none; }
  .zone .temp { color: var(--secondary-text-color); }
  .zones-edit { display: grid; gap: 4px; margin-bottom: 16px; }
  .zone-row { display: flex; align-items: center; gap: 8px; min-height: 40px; }
  .zone-row .name { flex: 1; font-size: 14px; color: var(--primary-text-color); }
  .zone-row .value { min-width: 48px; text-align: center; font-size: 16px; font-variant-numeric: tabular-nums; }
  .step {
    width: 36px;
    height: 36px;
    border-radius: 12px;
    border: 1px solid var(--divider-color);
    background: none;
    color: var(--primary-text-color);
    font-size: 18px;
    cursor: pointer;
  }
  .week { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; }
  .day {
    font-size: 13px;
    color: var(--secondary-text-color);
    background: none;
    border: none;
    padding: 0;
    font-family: inherit;
    text-align: start;
  }
  .day.today { color: var(--primary-text-color); font-weight: 500; }
  .day.open { color: var(--primary-color); font-weight: 500; }
  .bar {
    position: relative;
    height: 22px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--secondary-background-color, rgba(127, 127, 127, 0.15));
    border: none;
    padding: 0;
    width: 100%;
    display: block;
  }
  button.bar { cursor: pointer; }
  .bar.open { outline: 2px solid var(--primary-color); outline-offset: 2px; }
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
  .panel {
    margin-top: 16px;
    padding: 12px;
    border-radius: 12px;
    background: var(--secondary-background-color, rgba(127, 127, 127, 0.08));
  }
  .panel h3 { margin: 0 0 8px; font-size: 15px; font-weight: 500; color: var(--primary-text-color); }
  .slot { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .slot input, .slot select {
    height: 36px;
    padding: 0 8px;
    border-radius: 8px;
    border: 1px solid var(--divider-color);
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color);
    font: inherit;
    font-size: 14px;
  }
  .slot select { flex: 1; min-width: 0; }
  .slot input[disabled] { opacity: 0.6; }
  .dbar {
    position: relative;
    height: 48px;
    margin: 28px 12px 8px;
    border-radius: 10px;
    background: var(--secondary-background-color, rgba(127, 127, 127, 0.15));
    touch-action: none;
    user-select: none;
  }
  .dseg {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
    white-space: nowrap;
  }
  .dseg.first { border-radius: 10px 0 0 10px; }
  .dseg.last { border-radius: 0 10px 10px 0; }
  .dseg.first.last { border-radius: 10px; }
  .dbars { touch-action: none; }
  .dseg.sel { box-shadow: inset 0 0 0 3px var(--primary-text-color); }
  .handle {
    position: absolute;
    top: -6px;
    bottom: -6px;
    width: 32px;
    margin-left: -16px;
    display: flex;
    justify-content: center;
    cursor: ew-resize;
    touch-action: none;
    outline: none;
    z-index: 1;
  }
  .handle::before {
    content: "";
    width: 6px;
    border-radius: 3px;
    background: var(--card-background-color, #fff);
    box-shadow: 0 0 0 1px var(--divider-color), 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .handle:focus-visible::before { box-shadow: 0 0 0 2px var(--primary-color); }
  .handle .tip {
    position: absolute;
    bottom: calc(100% + 2px);
    padding: 1px 6px;
    border-radius: 6px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--primary-text-color);
    background: var(--card-background-color, #fff);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    white-space: nowrap;
  }
  .handle.dragging .tip { color: var(--primary-color); font-weight: 600; }
  .daxis {
    display: flex;
    justify-content: space-between;
    margin: 0 12px 12px;
    font-size: 11px;
    color: var(--secondary-text-color);
  }
  .selbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
  .selbar .label { width: 100%; font-size: 13px; color: var(--secondary-text-color); }
  .selbar .spacer { flex: 1; }
  details.precise { margin-top: 8px; }
  details.precise summary { cursor: pointer; font-size: 14px; color: var(--primary-color); padding: 4px 0; }
  details.precise[open] summary { margin-bottom: 8px; }
  .copy { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; font-size: 13px; color: var(--secondary-text-color); }
  .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  .actions .spacer { flex: 1; }
  .hint { font-size: 13px; color: var(--secondary-text-color); margin-bottom: 12px; }
  .message { color: var(--secondary-text-color); padding: 8px 0; }
  .message.error { color: var(--error-color, #db4437); }
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
    if (!this._resize && window.ResizeObserver) {
      this._resize = new ResizeObserver(() => {
        const narrow = this.getBoundingClientRect().width < SPLIT_DAY_WIDTH;
        if (narrow !== this._narrow) {
          this._narrow = narrow;
          if (this._draft && this._openDay !== undefined && this._dragging === undefined) this._draw();
        }
      });
      this._resize.observe(this);
    }
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    if (this._resize) {
      this._resize.disconnect();
      this._resize = undefined;
    }
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  // -- data ------------------------------------------------------------------

  async _load() {
    if (!this._hass) return;
    try {
      this._apply(await this._hass.callWS({ type: "smarther_hybrid/schedules" }));
      this._error = undefined;
    } catch (err) {
      this._error = err && err.message ? err.message : String(err);
    }
    // Don't redraw under the user's fingers while editing.
    if (!this._draft) this._draw();
  }

  // Ask Netatmo for the current list (new schedules from the app).
  async _refresh() {
    await this._ws({ type: "smarther_hybrid/refresh_schedules" }, "error");
    this._draw();
  }

  _apply(result) {
    this._homes = result.homes || [];
    this._netatmoFound = result.netatmo_found !== false;
  }

  async _ws(message, errorKey) {
    this._busy = message.type;
    this._actionError = undefined;
    this._draw();
    let ok = false;
    try {
      this._apply(await this._hass.callWS(message));
      ok = true;
    } catch (err) {
      const t = scheduleText(this._hass);
      this._actionError = `${t[errorKey]}: ${err && err.message ? err.message : err}`;
    }
    this._busy = undefined;
    return ok;
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

  _current(schedules) {
    return (
      schedules.find((s) => s.id === this._shown || s.name === this._shown) ||
      schedules.find((s) => s.selected) ||
      schedules[0]
    );
  }

  // Rooms in the schedule; temperatures and colours are per room.
  _rooms(schedule) {
    const rooms = new Map();
    for (const zone of schedule.zones) {
      for (const room of zone.rooms || []) rooms.set(room.id, room.name || room.id);
    }
    return [...rooms].map(([id, name]) => ({ id, name }));
  }

  _roomId(schedule) {
    const rooms = this._rooms(schedule);
    const wanted = this._room || this._config.room;
    const room = rooms.find((r) => r.id === wanted || r.name === wanted) || rooms[0];
    return room && room.id;
  }

  _temp(schedule, zone, roomId) {
    if (this._draft && this._draft.id === schedule.id) {
      const temps = this._draft.temps[String(zone.id)] || {};
      if (roomId in temps) return temps[roomId];
    }
    const room = (zone.rooms || []).find((r) => r.id === roomId);
    return room ? room.temperature : null;
  }

  _timetable(schedule) {
    return this._draft && this._draft.id === schedule.id
      ? timetableFromDays(this._draft.days)
      : schedule.timetable;
  }

  // -- editing ---------------------------------------------------------------

  _startEdit(schedule) {
    const temps = {};
    for (const zone of schedule.zones) {
      temps[String(zone.id)] = Object.fromEntries(
        (zone.rooms || []).map((r) => [r.id, r.temperature])
      );
    }
    this._draft = { id: schedule.id, temps, days: daySlots(schedule.timetable) };
    this._openDay = undefined;
    this._actionError = undefined;
    this._draw();
  }

  _cancelEdit() {
    this._draft = undefined;
    this._openDay = undefined;
    this._actionError = undefined;
    this._draw();
  }

  _stepTemp(zoneId, roomId, delta) {
    const temps = this._draft.temps[String(zoneId)];
    const value = Number(temps[roomId] ?? 20) + delta;
    temps[roomId] = Math.min(30, Math.max(5, Math.round(value * 2) / 2));
    this._draw();
  }

  _setSlot(day, index, field, value) {
    const slots = this._draft.days[day];
    if (field === "start") {
      const minutes = parseMinutes(value);
      const prev = slots[index - 1];
      const next = slots[index + 1];
      if (!Number.isFinite(minutes) || (prev && minutes <= prev.start) || (next && minutes >= next.start)) {
        this._actionError = scheduleText(this._hass).badTimes;
        this._draw();
        return;
      }
      slots[index].start = minutes;
    } else {
      const zone = this._draft.zoneIds.find((id) => String(id) === value);
      slots[index].zone = zone;
    }
    this._actionError = undefined;
    this._draw();
  }

  _addSlot(day) {
    const slots = this._draft.days[day];
    const last = slots[slots.length - 1];
    const start = Math.min(last.start + 60, DAY_MINUTES - 15);
    if (start <= last.start) return;
    const zone = this._draft.zoneIds.find((id) => !sameZone(id, last.zone)) ?? last.zone;
    slots.push({ start, zone });
    this._draw();
  }

  _removeSlot(day, index) {
    this._draft.days[day].splice(index, 1);
    this._draw();
  }

  _copyDay(day, targets) {
    for (const target of targets) {
      if (target !== day) {
        this._draft.days[target] = this._draft.days[day].map((slot) => ({ ...slot }));
      }
    }
    this._draw();
  }

  async _save(homeId, schedule) {
    const zones = Object.entries(this._draft.temps).map(([id, rooms]) => ({
      id: (schedule.zones.find((z) => String(z.id) === id) || { id }).id,
      // Rooms without a temperature are left as they are on Netatmo.
      rooms: Object.fromEntries(Object.entries(rooms).filter(([, temp]) => temp != null)),
    }));
    const ok = await this._ws(
      {
        type: "smarther_hybrid/save_schedule",
        home_id: homeId,
        schedule_id: schedule.id,
        zones,
        timetable: timetableFromDays(this._draft.days),
      },
      "saveError"
    );
    if (ok) this._draft = undefined;
    this._draw();
  }

  async _restore(homeId, schedule) {
    if (!window.confirm(scheduleText(this._hass).restoreConfirm)) return;
    const ok = await this._ws(
      { type: "smarther_hybrid/restore_schedule", home_id: homeId, schedule_id: schedule.id },
      "restoreError"
    );
    if (ok) this._draft = undefined;
    this._draw();
  }

  async _switch(homeId, scheduleId) {
    await this._ws(
      { type: "smarther_hybrid/switch_schedule", home_id: homeId, schedule_id: scheduleId },
      "activateError"
    );
    this._draw();
  }

  // -- rendering -------------------------------------------------------------

  _draw() {
    if (!this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const t = scheduleText(this._hass);
    const home = this._homes && this._home();
    const schedules = home ? home.schedules : [];
    const schedule = this._current(schedules);
    const editing = !!(this._draft && schedule && this._draft.id === schedule.id);
    if (editing) this._draft.zoneIds = schedule.zones.map((z) => z.id);

    let body;
    if (this._error) {
      body = `<div class="message error">${escapeHtml(t.error)}: ${escapeHtml(this._error)}</div>`;
    } else if (!this._homes) {
      body = "";
    } else if (!this._netatmoFound) {
      body = `<div class="message">${escapeHtml(t.noNetatmo)}</div>`;
    } else if (!schedule) {
      body = `<div class="message">${escapeHtml(t.empty)}</div>`;
    } else {
      const roomId = this._roomId(schedule);
      body =
        this._chips(schedules, schedule, t, editing) +
        this._roomChips(schedule, roomId, editing) +
        (editing ? `<div class="hint">${escapeHtml(t.editHint)}</div>` : this._activate(schedule, t)) +
        (editing ? this._zonesEdit(schedule, roomId) : this._legend(schedule, roomId, t)) +
        this._week(schedule, roomId, t, editing) +
        (editing && this._openDay !== undefined ? this._dayPanel(schedule, t) : "") +
        (this._actionError ? `<div class="message error">${escapeHtml(this._actionError)}</div>` : "") +
        (editing ? this._actions(schedule, t) : "");
    }

    const title = this._config.title || t.title;
    const canEdit = schedule && !editing && !this._error;
    this.shadowRoot.innerHTML = `
      <style>${SCHEDULE_STYLE}</style>
      <ha-card>
        <div class="header">
          <div class="title">${escapeHtml(title)}</div>
          ${canEdit ? `<button class="icon-btn" data-action="edit" type="button" title="${escapeHtml(t.edit)}" aria-label="${escapeHtml(t.edit)}"><ha-icon icon="mdi:pencil"></ha-icon></button>` : ""}
          ${editing ? "" : `<button class="icon-btn" data-action="refresh" type="button" aria-label="refresh" ${this._busy === "smarther_hybrid/refresh_schedules" ? "disabled" : ""}><ha-icon icon="mdi:refresh"></ha-icon></button>`}
        </div>
        ${body}
      </ha-card>`;
    this._bind(home, schedule);
  }

  _bind(home, schedule) {
    const root = this.shadowRoot;
    const on = (selector, event, handler) =>
      root.querySelectorAll(selector).forEach((el) => el.addEventListener(event, () => handler(el)));
    on('[data-action="refresh"]', "click", () => this._refresh());
    on('[data-action="edit"]', "click", () => this._startEdit(schedule));
    on('[data-action="cancel"]', "click", () => this._cancelEdit());
    on('[data-action="save"]', "click", () => this._save(home.id, schedule));
    on('[data-action="restore"]', "click", () => this._restore(home.id, schedule));
    on('[data-action="activate"]', "click", () => this._switch(home.id, schedule.id));
    on(".chip[data-schedule]", "click", (el) => {
      this._shown = el.dataset.schedule;
      this._draw();
    });
    on(".chip[data-room]", "click", (el) => {
      this._room = el.dataset.room;
      this._draw();
    });
    on("[data-step]", "click", (el) =>
      this._stepTemp(el.dataset.zone, el.dataset.room, Number(el.dataset.step))
    );
    on("[data-day]", "click", (el) => {
      const day = Number(el.dataset.day);
      this._openDay = this._openDay === day ? undefined : day;
      this._selSlot = 0;
      this._actionError = undefined;
      this._draw();
    });
    on("[data-slot-start]", "change", (el) =>
      this._setSlot(this._openDay, Number(el.dataset.slotStart), "start", el.value)
    );
    on("[data-slot-zone]", "change", (el) =>
      this._setSlot(this._openDay, Number(el.dataset.slotZone), "zone", el.value)
    );
    on("[data-slot-remove]", "click", (el) =>
      this._removeSlot(this._openDay, Number(el.dataset.slotRemove))
    );
    on('[data-action="add-slot"]', "click", () => this._addSlot(this._openDay));
    on("[data-sel-zone]", "click", (el) => this._setSelectedZone(el.dataset.selZone));
    on('[data-action="split"]', "click", () => this._splitSelected());
    on('[data-action="remove-sel"]', "click", () => this._removeSelected());
    this._bindSlider();
    on("[data-copy]", "click", (el) =>
      this._copyDay(this._openDay, el.dataset.copy.split(",").map(Number))
    );
  }

  _chips(schedules, current, t, editing) {
    if (schedules.length < 2) return "";
    const chips = schedules
      .map(
        (s) => `
        <button class="chip ${s.id === current.id ? "current" : ""}" type="button" data-schedule="${escapeHtml(s.id)}" ${editing ? "disabled" : ""}>
          ${s.selected ? '<ha-icon icon="mdi:check" style="--mdc-icon-size:16px"></ha-icon>' : ""}
          ${escapeHtml(s.name)}
          ${s.selected ? `<span class="badge">${escapeHtml(t.active)}</span>` : ""}
        </button>`
      )
      .join("");
    return `<div class="chips">${chips}</div>`;
  }

  _roomChips(schedule, roomId) {
    const rooms = this._rooms(schedule);
    if (rooms.length < 2) return "";
    const chips = rooms
      .map(
        (r) => `
        <button class="chip ${r.id === roomId ? "current" : ""}" type="button" data-room="${escapeHtml(r.id)}">
          <ha-icon icon="mdi:door" style="--mdc-icon-size:16px"></ha-icon>${escapeHtml(r.name)}
        </button>`
      )
      .join("");
    return `<div class="chips">${chips}</div>`;
  }

  _activate(schedule, t) {
    if (schedule.selected) return "";
    const busy = this._busy === "smarther_hybrid/switch_schedule";
    return `
      <button class="btn primary activate" data-action="activate" type="button" ${busy ? "disabled" : ""}>
        <ha-icon icon="mdi:calendar-check" style="--mdc-icon-size:18px"></ha-icon>
        ${escapeHtml(busy ? t.activating : t.activate)}
      </button>`;
  }

  // Same temperature, same colour: from cool blue to warm orange.
  _zoneColors(schedule, roomId) {
    const temps = schedule.zones
      .map((z) => this._temp(schedule, z, roomId))
      .filter((v) => v != null)
      .map(Number);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const colors = {};
    for (const zone of schedule.zones) {
      const temp = this._temp(schedule, zone, roomId);
      if (temp == null) {
        colors[String(zone.id)] = "var(--disabled-color, #bdbdbd)";
        continue;
      }
      const k = max > min ? (Number(temp) - min) / (max - min) : 1;
      const rgb = COOL_RGB.map((c, i) => Math.round(c + (WARM_RGB[i] - c) * k));
      colors[String(zone.id)] = `rgb(${rgb.join(",")})`;
    }
    return colors;
  }

  _legend(schedule, roomId, t) {
    const colors = this._zoneColors(schedule, roomId);
    const zones = schedule.zones
      .map((zone) => {
        const temp = formatTemp(this._temp(schedule, zone, roomId)) || t.noTemp;
        return `
          <span class="zone">
            <span class="swatch" style="background:${colors[String(zone.id)]}"></span>
            ${escapeHtml(zone.name || zone.id)}
            <span class="temp">${escapeHtml(temp)}</span>
          </span>`;
      })
      .join("");
    return `<div class="legend">${zones}</div>`;
  }

  _zonesEdit(schedule, roomId) {
    const colors = this._zoneColors(schedule, roomId);
    const rows = schedule.zones
      .map((zone) => {
        const temp = this._temp(schedule, zone, roomId);
        if (temp == null) return "";
        const data = `data-zone="${escapeHtml(zone.id)}" data-room="${escapeHtml(roomId)}"`;
        return `
          <div class="zone-row">
            <span class="swatch" style="background:${colors[String(zone.id)]}"></span>
            <span class="name">${escapeHtml(zone.name || zone.id)}</span>
            <button class="step" type="button" ${data} data-step="-0.5" aria-label="−">−</button>
            <span class="value">${escapeHtml(formatTemp(temp))}</span>
            <button class="step" type="button" ${data} data-step="0.5" aria-label="+">+</button>
          </div>`;
      })
      .join("");
    return `<div class="zones-edit">${rows}</div>`;
  }

  _week(schedule, roomId, t, editing) {
    const colors = this._zoneColors(schedule, roomId);
    const names = Object.fromEntries(schedule.zones.map((z) => [String(z.id), z.name || z.id]));
    const segments = daySegments(this._timetable(schedule));
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
          const tip = `${names[String(s.zone)] || s.zone} · ${formatMinutes(s.start)}–${formatMinutes(s.end)}`;
          return `<div class="seg" title="${escapeHtml(tip)}" style="left:${left}%;width:${width}%;background:${colors[String(s.zone)] || "var(--disabled-color)"}"></div>`;
        })
        .join("");
      const marker = day === today && !editing ? `<div class="now" style="left:${nowLeft}%"></div>` : "";
      const open = editing && this._openDay === day ? "open" : "";
      const dayCls = `day ${day === today ? "today" : ""} ${open}`;
      rows += editing
        ? `<button class="${dayCls}" type="button" data-day="${day}">${escapeHtml(t.days[day])}</button>
           <button class="bar ${open}" type="button" data-day="${day}" aria-label="${escapeHtml(t.dayNames[day])}">${segs}</button>`
        : `<div class="${dayCls}">${escapeHtml(t.days[day])}</div>
           <div class="bar">${segs}${marker}</div>`;
    }
    const axis = ["0", "6", "12", "18", "24"].map((h) => `<span>${h}</span>`).join("");
    return `<div class="week">${rows}<div class="axis">${axis}</div></div>`;
  }

  _dayPanel(schedule, t) {
    const day = this._openDay;
    const slots = this._draft.days[day];
    const colors = this._zoneColors(schedule, this._roomId(schedule));
    const names = Object.fromEntries(schedule.zones.map((z) => [String(z.id), z.name || z.id]));
    if (this._selSlot === undefined || this._selSlot >= slots.length) this._selSlot = 0;
    const sel = slots[this._selSlot];
    const selEnd = this._selSlot + 1 < slots.length ? slots[this._selSlot + 1].start : DAY_MINUTES;

    this._panelSchedule = schedule;

    const zoneChips = schedule.zones
      .map(
        (z) => `
        <button class="chip ${sameZone(z.id, sel.zone) ? "current" : ""}" type="button" data-sel-zone="${escapeHtml(z.id)}">
          <span class="swatch" style="background:${colors[String(z.id)]}"></span>${escapeHtml(z.name || z.id)}
        </button>`
      )
      .join("");
    const canSplit = selEnd - sel.start >= 2 * SLIDER_STEP;

    const options = (selected) =>
      schedule.zones
        .map(
          (z) =>
            `<option value="${escapeHtml(z.id)}" ${sameZone(z.id, selected) ? "selected" : ""}>${escapeHtml(z.name || z.id)}</option>`
        )
        .join("");
    const rows = slots
      .map(
        (slot, i) => `
        <div class="slot">
          <input type="time" step="900" value="${formatMinutes(slot.start)}" data-slot-start="${i}" ${i === 0 ? "disabled" : ""}>
          <select data-slot-zone="${i}">${options(slot.zone)}</select>
          ${i === 0 ? '<span style="width:36px"></span>' : `<button class="icon-btn" type="button" data-slot-remove="${i}" title="${escapeHtml(t.remove)}" aria-label="${escapeHtml(t.remove)}"><ha-icon icon="mdi:delete-outline"></ha-icon></button>`}
        </div>`
      )
      .join("");

    return `
      <div class="panel">
        <h3>${escapeHtml(t.dayNames[day])}</h3>
        <div class="hint">${escapeHtml(t.dragHint)}</div>
        <div class="dbars">${this._barsHtml()}</div>
        <div class="selbar">
          <span class="label">${escapeHtml(t.selected)}: ${escapeHtml(names[String(sel.zone)] || sel.zone)} ${formatMinutes(sel.start)}–${formatMinutes(selEnd)}</span>
          ${zoneChips}
          <span class="spacer"></span>
          <button class="btn" type="button" data-action="split" ${canSplit ? "" : "disabled"}>
            <ha-icon icon="mdi:content-cut" style="--mdc-icon-size:18px"></ha-icon>${escapeHtml(t.split)}
          </button>
          <button class="btn" type="button" data-action="remove-sel" ${this._selSlot > 0 ? "" : "disabled"}>
            <ha-icon icon="mdi:delete-outline" style="--mdc-icon-size:18px"></ha-icon>${escapeHtml(t.remove)}
          </button>
        </div>
        <details class="precise" ${this._preciseOpen ? "open" : ""}>
          <summary>${escapeHtml(t.preciseTimes)}</summary>
          ${rows}
          <button class="btn" type="button" data-action="add-slot">
            <ha-icon icon="mdi:plus" style="--mdc-icon-size:18px"></ha-icon>${escapeHtml(t.addSlot)}
          </button>
        </details>
        <div class="copy">
          ${escapeHtml(t.copyTo)}:
          <button class="chip" type="button" data-copy="0,1,2,3,4">${escapeHtml(t.weekdays)}</button>
          <button class="chip" type="button" data-copy="5,6">${escapeHtml(t.weekend)}</button>
          <button class="chip" type="button" data-copy="0,1,2,3,4,5,6">${escapeHtml(t.allDays)}</button>
        </div>
      </div>`;
  }

  // -- slider ------------------------------------------------------------------

  // Rows of the open day's bar: one for the whole day, or two (00–12,
  // 12–24) when the card is narrow, for twice the precision.
  _dayRows() {
    return this._narrow
      ? [[0, DAY_MINUTES / 2], [DAY_MINUTES / 2, DAY_MINUTES]]
      : [[0, DAY_MINUTES]];
  }

  _barsHtml() {
    const schedule = this._panelSchedule;
    const slots = this._draft.days[this._openDay];
    const colors = this._zoneColors(schedule, this._roomId(schedule));
    const names = Object.fromEntries(schedule.zones.map((z) => [String(z.id), z.name || z.id]));
    const ends = slots.map((slot, i) => (i + 1 < slots.length ? slots[i + 1].start : DAY_MINUTES));

    return this._dayRows()
      .map(([rowStart, rowEnd]) => {
        const span = rowEnd - rowStart;
        const pct = (m) => ((m - rowStart) / span) * 100;
        const parts = slots
          .map((slot, i) => ({ i, slot, start: Math.max(slot.start, rowStart), end: Math.min(ends[i], rowEnd) }))
          .filter((p) => p.end > p.start);
        const segs = parts
          .map((p, k) => {
            const width = pct(p.end) - pct(p.start);
            const cls = [
              "dseg",
              p.i === this._selSlot ? "sel" : "",
              k === 0 ? "first" : "",
              k === parts.length - 1 ? "last" : "",
            ].join(" ");
            const label = width > 14 ? escapeHtml(names[String(p.slot.zone)] || p.slot.zone) : "";
            return `<div class="${cls}" data-seg="${p.i}" style="left:${pct(p.start)}%;width:${width}%;background:${colors[String(p.slot.zone)] || "var(--disabled-color)"}">${label}</div>`;
          })
          .join("");
        // A boundary at 12:00 belongs to the second row.
        const handles = slots
          .map((slot, i) => ({ slot, i }))
          .filter(({ slot, i }) => i > 0 && slot.start >= rowStart && slot.start < rowEnd)
          .map(({ slot, i }) => {
            const time = formatMinutes(slot.start);
            return `
              <div class="handle ${i === this._dragging ? "dragging" : ""}" data-handle="${i}" tabindex="0" role="slider"
                aria-valuemin="0" aria-valuemax="${DAY_MINUTES}" aria-valuenow="${slot.start}"
                aria-valuetext="${time}" style="left:${pct(slot.start)}%">
                <span class="tip">${time}</span>
              </div>`;
          })
          .join("");
        const step = span / 4;
        const axis = [0, 1, 2, 3, 4]
          .map((k) => `<span>${(rowStart + k * step) / 60}</span>`)
          .join("");
        return `
          <div class="dbar" data-row-start="${rowStart}" data-row-end="${rowEnd}">${segs}${handles}</div>
          <div class="daxis">${axis}</div>`;
      })
      .join("");
  }

  // Allowed range for boundary `i` of the open day, in minutes.
  _handleRange(slots, i) {
    const min = slots[i - 1].start + SLIDER_STEP;
    const max = (i + 1 < slots.length ? slots[i + 1].start : DAY_MINUTES) - SLIDER_STEP;
    return [min, max];
  }

  _moveHandle(i, minutes) {
    const slots = this._draft.days[this._openDay];
    const [min, max] = this._handleRange(slots, i);
    const snapped = Math.round(minutes / SLIDER_STEP) * SLIDER_STEP;
    slots[i].start = Math.min(max, Math.max(min, snapped));
  }

  // Minutes under the pointer: the row is the one the finger is over (or the
  // closest), so a boundary can move from one row to the other in one drag.
  _minutesAt(container, ev) {
    let best;
    let bestDistance = Infinity;
    for (const bar of container.querySelectorAll(".dbar")) {
      const rect = bar.getBoundingClientRect();
      const distance =
        ev.clientY < rect.top ? rect.top - ev.clientY : ev.clientY > rect.bottom ? ev.clientY - rect.bottom : 0;
      if (distance < bestDistance) {
        best = { bar, rect };
        bestDistance = distance;
      }
    }
    const start = Number(best.bar.dataset.rowStart);
    const end = Number(best.bar.dataset.rowEnd);
    const x = Math.min(1, Math.max(0, (ev.clientX - best.rect.left) / best.rect.width));
    return start + x * (end - start);
  }

  // The pointer is captured by the bars' container, which survives redrawing
  // its content: only the bars are redrawn while dragging.
  _bindSlider() {
    const container = this.shadowRoot.querySelector(".dbars");
    if (!container) return;
    const repaint = () => {
      container.innerHTML = this._barsHtml();
    };
    container.addEventListener("pointerdown", (ev) => {
      const handle = ev.target.closest(".handle");
      if (!handle) return;
      ev.preventDefault();
      container.setPointerCapture(ev.pointerId);
      this._dragging = Number(handle.dataset.handle);
      this._selSlot = this._dragging;
      repaint();
    });
    container.addEventListener("pointermove", (ev) => {
      if (this._dragging === undefined) return;
      this._moveHandle(this._dragging, this._minutesAt(container, ev));
      repaint();
    });
    const end = (ev) => {
      if (this._dragging === undefined) return;
      if (container.hasPointerCapture(ev.pointerId)) container.releasePointerCapture(ev.pointerId);
      this._dragging = undefined;
      this._draw();
    };
    container.addEventListener("pointerup", end);
    container.addEventListener("pointercancel", end);
    container.addEventListener("click", (ev) => {
      const seg = ev.target.closest(".dseg");
      if (!seg) return;
      this._selSlot = Number(seg.dataset.seg);
      this._draw();
    });
    container.addEventListener("keydown", (ev) => {
      const handle = ev.target.closest(".handle");
      const delta = { ArrowLeft: -SLIDER_STEP, ArrowDown: -SLIDER_STEP, ArrowRight: SLIDER_STEP, ArrowUp: SLIDER_STEP }[ev.key];
      if (!handle || !delta) return;
      ev.preventDefault();
      const i = Number(handle.dataset.handle);
      this._moveHandle(i, this._draft.days[this._openDay][i].start + delta);
      this._selSlot = i;
      this._draw();
      const again = this.shadowRoot.querySelector(`.handle[data-handle="${i}"]`);
      if (again) again.focus();
    });
    const details = this.shadowRoot.querySelector("details.precise");
    if (details) {
      details.addEventListener("toggle", () => {
        this._preciseOpen = details.open;
      });
    }
  }

  // Merge neighbouring slots with the same zone; keep the selection on the
  // slot that contains `keep` (minutes).
  _normalizeDay(day, keep) {
    const merged = [];
    for (const slot of this._draft.days[day]) {
      if (!merged.length || !sameZone(merged[merged.length - 1].zone, slot.zone)) merged.push(slot);
    }
    this._draft.days[day] = merged;
    if (keep !== undefined) {
      let index = 0;
      merged.forEach((slot, i) => {
        if (slot.start <= keep) index = i;
      });
      this._selSlot = index;
    }
  }

  _setSelectedZone(value) {
    const slots = this._draft.days[this._openDay];
    const slot = slots[this._selSlot];
    slot.zone = this._draft.zoneIds.find((id) => String(id) === value) ?? slot.zone;
    this._normalizeDay(this._openDay, slot.start);
    this._draw();
  }

  _splitSelected() {
    const slots = this._draft.days[this._openDay];
    const slot = slots[this._selSlot];
    const end = this._selSlot + 1 < slots.length ? slots[this._selSlot + 1].start : DAY_MINUTES;
    const mid = Math.round((slot.start + end) / 2 / SLIDER_STEP) * SLIDER_STEP;
    if (mid <= slot.start || mid >= end) return;
    const zone = this._draft.zoneIds.find((id) => !sameZone(id, slot.zone)) ?? slot.zone;
    slots.splice(this._selSlot + 1, 0, { start: mid, zone });
    this._selSlot += 1;
    this._draw();
  }

  _removeSelected() {
    if (!this._selSlot) return;
    const keep = this._draft.days[this._openDay][this._selSlot - 1].start;
    this._draft.days[this._openDay].splice(this._selSlot, 1);
    this._normalizeDay(this._openDay, keep);
    this._draw();
  }

  _actions(schedule, t) {
    const saving = this._busy === "smarther_hybrid/save_schedule";
    const restoring = this._busy === "smarther_hybrid/restore_schedule";
    const busy = saving || restoring;
    const restore = schedule.backups
      ? `<button class="btn" type="button" data-action="restore" ${busy ? "disabled" : ""}>
           <ha-icon icon="mdi:history" style="--mdc-icon-size:18px"></ha-icon>${escapeHtml(t.restore)}
         </button>`
      : "";
    return `
      <div class="actions">
        ${restore}
        <span class="spacer"></span>
        <button class="btn outline" type="button" data-action="cancel" ${busy ? "disabled" : ""}>${escapeHtml(t.cancel)}</button>
        <button class="btn primary" type="button" data-action="save" ${busy ? "disabled" : ""}>${escapeHtml(saving ? t.saving : t.save)}</button>
      </div>`;
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
