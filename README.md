# Siderio Vcad

Web app per trasformare una serie di foto — più avanti anche i punti di un rilievo Leica DISTO 3D — in un modello 3D di una stanza o di una facciata. Le uscite previste sono mesh OBJ/GLB e pareti semplificate in STEP.

Questa versione è lo scheletro sul telefono: scatto, selezione delle foto, quote tra punti notevoli, archivio locale. La ricostruzione pesante non c’è ancora.

Interfaccia in italiano, pensata prima per il telefono (Android e iPhone). Accento arancio RAL 2008.

## Cosa fa adesso

- Elenco rilievi, nuovo rilievo, scheda rilievo
- Acquisizione con la fotocamera posteriore: scatto manuale o automatico (1 s / 2 s)
- Scarto sul dispositivo delle foto mosse (movimento del telefono e nitidezza rispetto agli scatti recenti) o troppo simili
- Una parete liscia non viene scartata: compare un avviso e si consiglia un bordo o un foglio con texture
- Avviso se si ruota troppo tra uno scatto e l’altro, o se si gira sul posto senza fare un passo
- Mappa di copertura per fasce (giù, orizzonte, su 30–45°), pellicola delle foto accettate, consigli di ripresa
- Coda di caricamento verso Cloudflare R2: le foto accettate partono da sole, con retry, e `project.json` si aggiorna quando cambiano le quote
- Segni nominati sulle foto (stesso punto su più scatti) e distanze note in millimetri, senza coppie duplicate
- Esportazione ZIP: foto originali in ordine (`foto/001.jpg`…) e `project.json`
- PWA: dopo il primo caricamento le pagine già viste funzionano anche senza rete

Le foto restano in IndexedDB finché il caricamento non è confermato. Si possono poi liberare dal telefono. Le chiavi R2 stanno solo sul server.

## Struttura

```
app/                  Next.js (radice: Vercel builda da qui)
components/           schermate
lib/data/             repository: oggi IndexedDB, domani Supabase
lib/capture/          fotocamera, selettore, orientamento
lib/upload/           coda di caricamento verso R2
lib/storage/          chiavi e client S3, solo server
lib/export/           ZIP e project.json
worker/               segnaposto del worker Python (non va su Vercel)
public/brand, icons   marchio Siderio
```

Il repository in `lib/data/repository.ts` è l’unico punto che le pagine usano per leggere e scrivere. Un’implementazione Supabase potrà sostituirlo senza rifare le schermate.

## Sviluppo

```bash
npm install
npm run dev
npm run lint
npm run build
```

Apri `http://localhost:3000` dal telefono solo se il dev server è in HTTPS: la fotocamera non parte in chiaro. L’anteprima Vercel è il modo giusto per provarla.

Su Vercel il progetto è **siderio-vcad**, build dalla radice. Servono, solo lato server, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Per accodare un job servono anche `RUNPOD_API_KEY` e `RUNPOD_ENDPOINT_ID`. L’endpoint R2 è `https://<account>.r2.cloudflarestorage.com`. La cartella `worker/` è in `.vercelignore`.

`GET /api/storage/health` dice se le variabili ci sono e se il bucket risponde, senza mai restituire i valori.

## Limiti di questa versione

- I risultati del motore si aprono da ogni rilievo (`/rilievo/<id>/risultati`): modello GLB, pareti STEP, scarichi e stato. L’invio al motore usa `RUNPOD_API_KEY` e `RUNPOD_ENDPOINT_ID` (solo server). Senza quelle due variabili il pulsante resta spento
- Non c’è ancora login: la route di presign accetta solo chiavi `rilievi/<uuid>/…`, jpeg o `project.json`, al massimo 25 MB, URL validi 10 minuti. L’auth arriverà con Supabase
- La mappa di copertura usa bussola e inclinazione, non una ricostruzione
- Su iPhone lo scatto a piena risoluzione dipende da ciò che Safari concede allo stream video (`ImageCapture` lì di solito non c’è)
- Senza permesso ai sensori la mappa resta vuota; le foto si salvano lo stesso
