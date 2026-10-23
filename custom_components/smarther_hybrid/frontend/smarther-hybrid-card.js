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
const loadHelpers = () => {
  if (!helpersPromise && window.loadCardHelpers) {
    helpersPromise = window.loadCardHelpers();
  }
  return helpersPromise;
};
loadHelpers();

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
