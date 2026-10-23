# Smarther Hybrid

Integrazione custom per Home Assistant che unisce in **una sola entità climate** le due integrazioni già disponibili per il termostato **BTicino Smarther with Netatmo (Smarther2)**:

| Cosa | Da dove | Velocità |
|---|---|---|
| Temperatura attuale, sta scaldando sì/no | HomeKit Device (locale) | istantanea |
| Setpoint (lettura e scrittura) | HomeKit Device (locale) | istantanea, anche senza internet |
| Riscaldamento / Spento | HomeKit Device (locale) | istantanea, anche senza internet |
| Preset Mantieni | questa integrazione via HomeKit (locale) | istantanea, anche senza internet |
| Preset Programma, Assenza, Boost, Antigelo | Netatmo (cloud) | dipende dal cloud e dai webhook |
| Programma selezionato | Netatmo (cloud) | dipende dal cloud e dai webhook |
| Umidità (facoltativa) | sensore a scelta | come il sensore |

L'integrazione **non parla direttamente con il termostato**: legge e comanda le due entità esistenti. Non fa polling, si aggiorna quando cambia una delle due.

## Requisiti

- Il termostato abbinato a Home Assistant con l'integrazione **HomeKit Device** (`homekit_controller`).
- Lo stesso termostato configurato nell'integrazione **Netatmo**. Per avere preset reattivi conviene attivare i webhook, con un'app sviluppatore Netatmo propria e Home Assistant raggiungibile in HTTPS sulla porta 443.
- Home Assistant 2024.11 o successivo.
- Consigliato: nell'app Home + Control imposta la **durata delle modifiche manuali a 12 ore** (il massimo).

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

## Modalità e preset

**Modalità** (HomeKit, locale): **Riscaldamento** (acceso) e **Spento** (off vero = **antigelo 7 °C**). La modalità non cambia in base al preset.

**Preset:**

| Preset | Icona | Cosa fa | Serve internet |
|---|---|---|---|
| **Programma** | orologio | il termostato segue il programma settimanale | sì (Netatmo) |
| **Mantieni** | lucchetto | tiene la temperatura attuale contro il programma (vedi sotto) | no |
| **Assenza** | standard | temperatura di assenza | sì (Netatmo) |
| **Boost** | standard | riscaldamento al massimo | sì (Netatmo) |
| **Antigelo** | termometro con fiocco | antigelo | sì (Netatmo) |
| **Manuale** | dito | mostrato quando c'è una modifica manuale, non selezionabile | — |

Senza Mantieni, cambiare la temperatura crea una normale modifica manuale, che scade dopo la durata impostata nell'app e poi il termostato torna al programma.

### Mantieni

Scegliendo il preset **Mantieni**, l'integrazione memorizza il setpoint attuale (attributi `hold_active` e `hold_temperature`) e lo difende:

1. Quando il termostato torna al programma (modifica manuale scaduta), il setpoint viene **rimandato via HomeKit** circa un minuto dopo, il tempo che Netatmo confermi il motivo del cambio.
2. Come sicurezza viene rimandato anche **ogni 3 ore** (configurabile in *Opzioni*, 0 = disattivato; tienilo sotto la durata delle modifiche manuali dell'app).

Regole:
- Se cambi la temperatura **dall'entità**, il nuovo valore diventa quello mantenuto.
- Se la cambi **dal termostato o dall'app**, l'integrazione **adotta** il nuovo valore invece di sovrascriverlo.
- Mantieni **finisce** scegliendo Spento o un altro preset (anche dall'app), o se il termostato viene spento altrove.
- Non si può attivare su un setpoint da antigelo (7 °C o meno).
- Sopravvive ai riavvii di Home Assistant.

## Comportamento

- **Spento = antigelo.** "Spento" manda il vero off al termostato via HomeKit, e lo Smarther lo interpreta come **antigelo (7 °C)**. Attenzione: anche il comando generico `climate.turn_off` (assistenti vocali, automazioni "spegni tutto") porta il termostato in antigelo.
- **Accendi** (`climate.turn_on`) equivale a scegliere Riscaldamento.
- **Scelta del programma settimanale:** usa la select creata dall'integrazione Netatmo.

## Limiti noti

- **Senza internet** funzionano stato, setpoint, Riscaldamento, Spento e Mantieni; gli altri preset danno errore finché il cloud Netatmo non torna. Mantieni non può distinguere un ritorno al programma da un cambio fatto sul termostato, quindi adotta il nuovo valore.
- **Senza HomeKit** (termostato non raggiungibile in rete) l'entità risulta non disponibile.
- Lo stato dei preset arriva dall'integrazione Netatmo: senza webhook può arrivare con alcuni minuti di ritardo.
- Il comportamento di setpoint e spegnimento fatti via HomeKit rispetto ai programmi Netatmo è stato dedotto e va confermato sul proprio termostato.
- Solo riscaldamento: il raffrescamento (Smarther con condizionatore) non è gestito.

## Sviluppo

```
pip install pytest-homeassistant-custom-component
pytest
```

## Licenza

MIT
