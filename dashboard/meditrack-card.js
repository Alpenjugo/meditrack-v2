/*
 * MediTrack-Dashboardkarte für Home Assistant (auch für Nicht-Admin-Benutzer).
 *
 * Bettet ein Ingress-Add-on per iframe ein. Im Unterschied zu anderen
 * Ingress-Karten nutzt sie ausschliesslich die Websocket-Befehle, die Home
 * Assistant auch normalen Benutzern erlaubt:
 *   hassio/ingress/info, hassio/ingress/session, hassio/ingress/validate_session
 * Der allgemeine Befehl "supervisor/api" ist nur für Administratoren erlaubt.
 *
 * Voraussetzung: Add-on mit "panel_admin: false" (ab MediTrack 1.3.1).
 * Home Assistant prüft dann selbst, ob der angemeldete Benutzer zugreifen darf.
 *
 * Installation: Datei nach /config/www/meditrack-card.js kopieren und unter
 * Einstellungen → Dashboards → ⋮ → Ressourcen als
 *   URL: /local/meditrack-card.js   Typ: JavaScript-Modul
 * hinzufügen.
 *
 * Konfiguration:
 *   type: custom:meditrack-card
 *   addon: 3aa2d0b6_meditrack   # Slug des Add-ons (aus der Adresszeile)
 *   height: 80vh                # optional
 */
const VALIDATE_EVERY_MS = 60 * 1000;

class MeditrackCard extends HTMLElement {
  setConfig(config) {
    if (!config || !config.addon) throw new Error("Bitte 'addon' (Slug des Add-ons) angeben");
    this._config = { height: "80vh", path: "", ...config };
    this._rendered = false;
    if (this._hass && this.isConnected) this._start();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && this._config && this.isConnected) this._start();
  }

  connectedCallback() {
    if (this._hass && this._config && !this._timer) this._start();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this._timer = null;
  }

  getCardSize() { return 8; }

  async _start() {
    if (this._starting) return;
    this._starting = true;
    try {
      const slug = this._config.addon;
      const info = await this._hass.callWS({ type: "hassio/ingress/info", slug });
      if (!info || !info.ingress_url) throw new Error("Add-on unterstützt kein Ingress");
      await this._newSession();
      clearInterval(this._timer);
      this._timer = setInterval(() => this._validate(), VALIDATE_EVERY_MS);
      const base = info.ingress_url.replace(/\/+$/, "");
      const path = String(this._config.path || "").replace(/^\/+/, "");
      this._renderFrame(`${base}/${path}`);
    } catch (err) {
      this._renderError(err);
    } finally {
      this._starting = false;
    }
  }

  async _newSession() {
    const res = await this._hass.callWS({ type: "hassio/ingress/session", slug: this._config.addon });
    this._session = res.session;
    // gleiches Cookie wie das Home-Assistant-Frontend: nur für Ingress-Pfade
    const secure = location.protocol === "https:" ? ";Secure" : "";
    document.cookie = `ingress_session=${this._session};path=/api/hassio_ingress/;SameSite=Strict${secure}`;
  }

  async _validate() {
    try {
      await this._hass.callWS({ type: "hassio/ingress/validate_session", session: this._session });
    } catch (_) {
      try { await this._newSession(); } catch (err) { this._renderError(err); }
    }
  }

  _renderFrame(src) {
    if (this._rendered && this._frame && this._frame.getAttribute("src") === src) return;
    this.innerHTML = "";
    const card = document.createElement("ha-card");
    card.style.overflow = "hidden";
    const frame = document.createElement("iframe");
    frame.setAttribute("src", src);
    frame.setAttribute("title", "MediTrack");
    frame.style.cssText = `border:0;width:100%;height:${this._config.height};display:block;`;
    card.appendChild(frame);
    this.appendChild(card);
    this._frame = frame;
    this._rendered = true;
  }

  _renderError(err) {
    this._rendered = false;
    const msg = (err && (err.message || err.code)) || String(err);
    const hint = /unauthori[sz]ed/i.test(msg)
      ? "Kein Zugriff: Ist MediTrack 1.3.1 oder neuer installiert (Seitenleiste auch für normale Benutzer)?"
      : /unknown command/i.test(msg)
        ? "Diese Home-Assistant-Version kennt die benötigten Befehle nicht – bitte Home Assistant aktualisieren."
        : "MediTrack konnte nicht geladen werden.";
    this.innerHTML = "";
    const card = document.createElement("ha-card");
    const box = document.createElement("div");
    box.style.padding = "16px";
    const p1 = document.createElement("p");
    p1.textContent = hint;
    const p2 = document.createElement("p");
    p2.style.opacity = "0.7";
    p2.style.fontSize = "0.9em";
    p2.textContent = `Details: ${msg}`;
    box.append(p1, p2);
    card.appendChild(box);
    this.appendChild(card);
  }
}

if (!customElements.get("meditrack-card")) {
  customElements.define("meditrack-card", MeditrackCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "meditrack-card",
    name: "MediTrack",
    description: "MediTrack im Dashboard – funktioniert auch für Benutzer ohne Adminrechte.",
  });
}
