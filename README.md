# Siderio Vcad

Visualizzatore DWG/DXF standalone. Si installa come PWA, funziona senza rete e **non** parla con Siderio Suite: niente login, niente commesse, niente risalita.

Si usa così: **Apri DXF / DWG** (o **Esempio** per il piano terra di prova) → spegni layer e campiture → quota due estremi del disegno → stampa un riquadro.

---

## Quote

- Due estremi **agganciati a entità vere** del DXF: la misura esce da sola, in scala col disegno. Linee e cifra **verdi**.
- Cerchi e archi: centro + bordo → **raggio** (`R …`); due punti opposti sulla circonferenza → **diametro** (`Ø …`).
- Due click sugli estremi, il terzo sopra o sotto per la linea di quota. Tasto destro: salta lo scostamento e passa alla quota successiva. Gli estremi restano agganciati.
- mm/cm/m in *Layer e campiture* sono l'**unità della cifra**. Se il file ha già `$INSUNITS`, non si ricalcolano le coordinate.
- Si può **riscrivere** un valore: l'originale resta, il nuovo va **sotto tra parentesi** (rosso).
- Se un estremo non aggancia un'entità: **solo testo inserito**, tutto **rosso**. Niente cifra automatica.
- Senza CAD le quote automatiche non esistono.
- Se il DXF **non dichiara le unità** (disegno puro): da *Layer e campiture* si imposta mm/cm/m, un **fattore** (anche `1:100`) oppure si **calibra** due punti con la misura vera. Le quote verdi si ricalcolano; le note tra parentesi restano.

## Layer e campiture

Un comando spegne tutte le HATCH. Ogni layer ha on/off. I blocchi (`INSERT`) vengono esplosi in lettura.

## Stampa riquadro

Da **Layer e campiture** → *Stampa riquadro*: si tracciano due angoli, esce un PDF A4 di quella porzione.

## DWG

Il formato binario AutoCAD non si legge per intero nel browser. Se il file è un DXF con estensione `.dwg`, o contiene frammenti ASCII, si apre. Altrimenti esporta come **DXF ASCII** da AutoCAD. Il file originale resta comunque allegato al taccuino.

La conversione nativa DWG→DXF è prevista sull'exe Windows (doppio click sul file), non in questa PWA.

---

## Sviluppo

```bash
npm install
npm run dev
npm run build
```

Nessuna variabile d'ambiente. Su Vercel: framework Next.js, nome progetto **Siderio Vcad**, nessuna env.

---

## Repo `Siderio-Vcad`

Il codice ufficiale va su **https://github.com/davono71-png/Siderio-Vcad** (repo nuova, senza Suite). Questa copia su Rilievi è solo il lavoro in corso: **non unire** la PR su `main` di Rilievi.

Cursor non può scrivere su `Siderio-Vcad` finché l’app GitHub **Cursor** ha accesso a quel repo **e** in fondo alla pagina si preme **Save**:

1. [github.com/apps/cursor](https://github.com/apps/cursor) → *Configure* → *Repository access* → **All repositories** (oppure aggiungi **Siderio-Vcad**)
2. **Save** in basso a sinistra — senza Save GitHub non registra nulla

Il sito su Vercel legge **solo** `Siderio-Vcad` / `main`. La UI a card, le quote a tre click e l’arancio RAL 2008 stanno su questo ramo: se apri il sito e vedi ancora le linguette viola, è il seed vecchio. Ripubblica **questo** albero (non il ramo `cursor/siderio-vcad-seed-9152`):

Da Windows, in una cartella nuova:

```bat
git clone --branch cursor/vcad-desktop-cards-9152 https://github.com/davono71-png/Siderio-Rilievi.git vcad-ui
cd vcad-ui
bash scripts/publish-vcad.sh https://github.com/davono71-png/Siderio-Vcad.git
```

oppure, da questa cartella già aperta:

```bash
./scripts/publish-vcad.sh
```

Poi su Vercel aspetta il deploy e nel browser fai **Ctrl+Shift+R** (se hai installato la PWA: chiudila e riaprila).
