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
 * Every other option is passed to the thermostat card unchanged.
 */

const CARD_TYPE = "smarther-hybrid-card";

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
    const lang = (this._hass && this._hass.language) || "en";
    return (TEXT[lang.split("-")[0]] || TEXT.en)[key];
  }

  _render() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="wrap">
        <div class="card"></div>
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
  }

  async _buildCard() {
    const { type, humidity_entity, ...inner } = this._config;
    this._buildId = (this._buildId || 0) + 1;
    const build = this._buildId;
    const helpers = await loadHelpers();
    if (!helpers || build !== this._buildId) return;

    const card = helpers.createCardElement({ ...inner, type: "thermostat" });
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
