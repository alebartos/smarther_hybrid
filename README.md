# Smarther Hybrid

Integrazione custom per Home Assistant che unisce in **una sola entità climate** le due integrazioni già disponibili per il termostato **BTicino Smarther with Netatmo (Smarther2)**:

| Cosa | Da dove | Velocità |
|---|---|---|
| Temperatura attuale, sta scaldando sì/no | HomeKit Device (locale) | istantanea |
| Setpoint (lettura e scrittura) | HomeKit Device (locale) | istantanea, anche senza internet |
| Riscaldamento (mantieni) / Spento | HomeKit Device (locale) | istantanea, anche senza internet |
| Auto (comanda Netatmo, rimanda l'ultimo preset) | Netatmo (cloud) | dipende dal cloud e dai webhook |
| Preset: Programma, Assenza, Boost | Netatmo (cloud) | dipende dal cloud e dai webhook |
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

## Modalità

| Modalità | Significato | Come funziona |
|---|---|---|
| **Auto** | comanda Netatmo: programma settimanale o il preset scelto (Assenza, Boost) | rimanda a Netatmo **l'ultimo preset scelto**, anche se scelto dall'app; all'inizio Programma (serve internet) |
| **Riscaldamento** | tiene la temperatura scelta da te, anche contro il programma | vedi "Mantenimento" sotto (locale) |
| **Spento** | off vero del termostato = **antigelo (7 °C)**; resta Spento anche quando lo Smarther si riporta "acceso a 7 °C", e anche se l'antigelo viene messo dall'app | HomeKit (locale) |

In **Auto** puoi cambiare preset quando vuoi: la modalità resta Auto e il preset scelto resta visibile. L'ultimo preset scelto è nell'attributo `last_preset`. Cambiare la temperatura in Auto crea una normale modifica manuale (preset "Manuale"), che scade dopo la durata impostata nell'app.

### Mantenimento (Riscaldamento)

Scegliendo **Riscaldamento**, l'integrazione memorizza il setpoint attuale (attributi `hold_active` e `hold_temperature`) e lo difende:

1. Quando il termostato torna al programma (modifica manuale scaduta), il setpoint viene **rimandato via HomeKit** circa un minuto dopo, il tempo che Netatmo confermi il motivo del cambio.
2. Come sicurezza viene rimandato anche **ogni 3 ore** (configurabile in *Opzioni*, 0 = disattivato; tienilo sotto la durata delle modifiche manuali dell'app).

Regole:
- Se cambi la temperatura **dall'entità**, il nuovo valore diventa quello mantenuto.
- Se la cambi **dal termostato o dall'app**, l'integrazione **adotta** il nuovo valore invece di sovrascriverlo.
- Il mantenimento **finisce** scegliendo Auto, Spento o un preset (anche se scelti dall'app), o se il termostato viene spento altrove.
- Un setpoint da antigelo (7 °C o meno) non viene mai mantenuto.
- Sopravvive ai riavvii di Home Assistant.

## Comportamento

- **Spento = antigelo.** "Spento" manda il vero off al termostato via HomeKit, e lo Smarther lo interpreta come **antigelo (7 °C)**. Attenzione: anche il comando generico `climate.turn_off` (assistenti vocali, automazioni "spegni tutto") porta il termostato in antigelo.
- **Accendi** (`climate.turn_on`) equivale a scegliere Riscaldamento.
- **Preset** (Programma, Assenza, Boost) vanno a Netatmo. Non c'è un preset Antigelo: sullo Smarther antigelo e spento sono la stessa cosa, quindi è la modalità **Spento**. I preset terminano il mantenimento. **"Manuale"** viene mostrato quando Netatmo segnala una modifica manuale, ma non si può selezionare.
- **Programma riporta davvero la stanza al programma.** Il preset Netatmo cambia solo la modalità della casa; una modifica manuale della stanza (es. fatta via HomeKit o in Riscaldamento) resterebbe attiva. Per questo Programma, scelto direttamente o tramite Auto, manda anche `netatmo.clear_temperature_setting`.
- **Scelta del programma settimanale:** usa la select creata dall'integrazione Netatmo.
- **Comandi a Netatmo distanziati di 3 secondi.** Netatmo è lento: il primo comando parte subito, quelli che arrivano entro 3 secondi aspettano, e della coda parte solo l'ultimo (es. Assenza → Boost → Programma in fretta: a Netatmo arriva Assenza e poi Programma). Scegliere Spento o Riscaldamento annulla i comandi Netatmo in coda. I comandi HomeKit partono sempre subito.

## Card per la dashboard

L'integrazione installa anche una card, **Smarther Hybrid**. Non serve aggiungere risorse a mano: l'integrazione la registra da sola tra le **risorse della dashboard** (Impostazioni → Dashboard → Risorse) e compare tra le card dopo il riavvio. Se gestisci le risorse in YAML, aggiungi tu `/smarther_hybrid/smarther-hybrid-card.js` come `module`. È la card termostato di Home Assistant, identica, con in più:

- **in basso a sinistra**, sopra le modalità: l'**umidità** in un piccolo quadrante come quello del termostato, con la percentuale al centro e una goccia sullo sfondo (colore personalizzabile con la variabile del tema `--smarther-humidity-color`);
- **in basso a destra**, sopra le modalità: il **pallino di sincronizzazione**
  - 🟢 verde: tutti i comandi inviati sono stati confermati,
  - 🟠 arancione: Netatmo ha accettato il comando, ma non ha ancora riportato il nuovo stato (può volerci qualche minuto),
  - 🔴 rosso (lampeggia): comando in coda, in viaggio o rifiutato (passandoci sopra si vede quale),
  - ⚪ grigio: termostato non disponibile.

```yaml
type: custom:smarther-hybrid-card
entity: climate.smarther_soggiorno
humidity_entity: sensor.umidita_soggiorno   # facoltativo: senza, usa l'umidità dell'entità
features:
  - type: climate-hvac-modes
    hvac_modes: [auto, heat, "off"]
  - type: climate-preset-modes
    style: dropdown
```

### Pulsante facoltativo

In **alto a sinistra** puoi aggiungere un pulsante con un'icona a scelta che esegue le **azioni standard di Home Assistant**: navigare a un'altra pagina della dashboard, aprire un URL, eseguire un'azione o uno script, aprire le info di un'entità… Si può impostare un'azione per il tocco e una per la pressione prolungata.

```yaml
button:
  icon: mdi:calendar-clock      # predefinita: mdi:gesture-tap-button
  name: Programmi               # suggerimento al passaggio del mouse
  tap_action:
    action: navigate
    navigation_path: /lovelace/riscaldamento
  hold_action:                  # facoltativa
    action: more-info
```

La card ha l'**editor visuale**: è quello della card termostato di Home Assistant (entità, nome, funzionalità come modalità e preset…) con in più il campo **Sensore umidità** e la sezione **Pulsante**. In alternativa puoi usare lo YAML.

Tutte le altre opzioni della card termostato (`name`, `features`, `show_current_as_primary`…) funzionano allo stesso modo.

### Sincronizzazione

Un comando è "confermato" quando la sorgente riporta il valore inviato:

| Comando | Confermato quando |
|---|---|
| Setpoint, Riscaldamento/Spento, rinvio del mantenimento | **HomeKit** riporta quel valore (risposta del termostato, in locale) |
| Preset e Auto | accettato quando il **cloud Netatmo** risponde OK (🟠), confermato quando **Netatmo** riporta quel preset (🟢) |

Un comando rifiutato resta rosso finché non ne mandi un altro dello stesso tipo. Un comando superato da un altro (es. un preset in coda annullato da Spento) non conta più. L'entità espone `synced`, `sync_state` (`synced`/`accepted`/`pending`) e `pending`; c'è anche il sensore binario **"… sincronizzato"**, utile per le automazioni (es. avviso se resta spento per più di 10 minuti).

## Card del programma

Una seconda card, **Smarther Schedule**, mostra e modifica i **programmi di riscaldamento Netatmo**:

- vista settimanale, una barra per giorno con le fasce colorate per temperatura (dal blu, più freddo, all'arancione, più caldo: stessa temperatura, stesso colore) e un indicatore dell'ora attuale;
- legenda delle zone con la temperatura; se il programma riguarda più stanze, chip per sceglierne una;
- chip per guardare gli altri programmi e pulsante **Attiva questo programma**;
- **✏️ Modifica**:
  - temperatura di ogni zona con − / + (5–30 °C, passi di 0,5);
  - tocca un giorno per modificarne le fasce con lo **slider**: trascini i confini (passi di 15 minuti, orario mostrato sopra la maniglia, anche con le frecce della tastiera), tocchi una fascia per cambiarne la zona, **Dividi** / **Rimuovi**;
  - su schermi stretti (card sotto i 500 px, es. telefono) il giorno è diviso in **due righe, 00–12 e 12–24**, per il doppio della precisione; un confine si può trascinare da una riga all'altra con un solo gesto;
  - **Orari precisi** (da aprire) per scrivere gli orari a mano e aggiungere fasce;
  - copia del giorno su Lun–Ven, Sab–Dom o tutti i giorni;
  - **Salva** riscrive il programma su Netatmo **mantenendone il nome**; **Annulla** scarta le modifiche;
  - prima di ogni salvataggio viene conservata una **copia di backup** (le ultime 10 per programma); **Ripristina versione precedente** la rimette.

```yaml
type: custom:smarther-schedule-card
title: Programma soggiorno   # facoltativo
room: Soggiorno              # facoltativo, se il programma ha più stanze
```

I dati vengono da quelli che l'integrazione Netatmo ha già in memoria (nessuna chiamata in più al cloud per leggerli) e si aggiornano ogni minuto. Consiglio: prova le prime modifiche su un **programma duplicato** creato dall'app.

## Limiti noti

- **Senza internet** funzionano stato, setpoint, Riscaldamento e Spento; Auto e i preset danno errore finché il cloud Netatmo non torna. Il mantenimento non può distinguere un ritorno al programma da un cambio fatto sul termostato, quindi adotta il nuovo valore.
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
