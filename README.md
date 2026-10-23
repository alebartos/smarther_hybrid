# Smarther Hybrid

Integrazione custom per Home Assistant che unisce in **una sola entità climate** le due integrazioni già disponibili per il termostato **BTicino Smarther with Netatmo (Smarther2)**:

| Cosa | Da dove | Velocità |
|---|---|---|
| Temperatura attuale, sta scaldando sì/no | HomeKit Device (locale) | istantanea |
| Setpoint (lettura e scrittura) | HomeKit Device (locale) | istantanea, anche senza internet |
| Riscaldamento / Spento | HomeKit Device (locale) | istantanea, anche senza internet |
| Preset: Programma, Assenza, Boost, Antigelo | Netatmo (cloud) | dipende dal cloud e dai webhook |
| Programma selezionato | Netatmo (cloud) | dipende dal cloud e dai webhook |
| Umidità (facoltativa) | sensore a scelta | come il sensore |

L'integrazione **non parla direttamente con il termostato**: legge e comanda le due entità esistenti. Non fa polling, si aggiorna quando cambia una delle due.

## Requisiti

- Il termostato abbinato a Home Assistant con l'integrazione **HomeKit Device** (`homekit_controller`).
- Lo stesso termostato configurato nell'integrazione **Netatmo**. Per avere preset reattivi conviene attivare i webhook, con un'app sviluppatore Netatmo propria e Home Assistant raggiungibile in HTTPS sulla porta 443.
- Home Assistant 2024.8 o successivo.

## Installazione con HACS

1. HACS → menu ⋮ → **Repository personalizzati**.
2. URL: `https://github.com/alebartos/smarther_hybrid`, categoria **Integrazione** → Aggiungi.
3. Cerca **Smarther Hybrid** in HACS → **Scarica**.
4. Riavvia Home Assistant.
5. **Impostazioni → Dispositivi e servizi → Aggiungi integrazione → Smarther Hybrid** e scegli:
   - il nome (es. "Smarther Soggiorno"),
   - l'entità climate **HomeKit** del termostato,
   - l'entità climate **Netatmo** del termostato,
   - facoltativo: il sensore di umidità HomeKit del termostato.

### Installazione manuale

Copia la cartella `custom_components/smarther_hybrid` in `/config/custom_components/` e riavvia Home Assistant.

## Comportamento

- **Spento = antigelo.** "Spento" manda il vero off al termostato via HomeKit, e lo Smarther lo interpreta come **antigelo (7 °C)**. Attenzione: anche il comando generico `climate.turn_off` (assistenti vocali, automazioni "spegni tutto") porta il termostato in antigelo.
- **Setpoint via HomeKit.** Un setpoint impostato dall'entità è una modifica manuale per il termostato. Per tornare al programma settimanale scegli il preset **Programma**.
- **Preset "Manuale"** viene mostrato quando Netatmo segnala una modifica manuale, ma non si può selezionare.
- **Scelta del programma settimanale:** usa la select creata dall'integrazione Netatmo.

## Limiti noti

- **Senza internet** funzionano stato, setpoint e acceso/spento; i preset danno errore finché il cloud Netatmo non torna.
- **Senza HomeKit** (termostato non raggiungibile in rete) l'entità risulta non disponibile.
- Lo stato dei preset arriva dall'integrazione Netatmo: senza webhook può arrivare con alcuni minuti di ritardo.
- Il comportamento di setpoint e spegnimento fatti via HomeKit rispetto ai programmi Netatmo è stato dedotto e va confermato sul proprio termostato.
- Solo riscaldamento: il raffrescamento (Smarther con condizionatore) non è gestito.

## Licenza

MIT
