# Siderio Vcad

Web app per trasformare una serie di foto — più avanti anche i punti di un rilievo Leica DISTO 3D — in un modello 3D di una stanza o di una facciata. Le uscite previste sono mesh OBJ/GLB e pareti semplificate in STEP.

Questa versione è lo scheletro sul telefono: scatto, selezione delle foto, quote tra punti notevoli, archivio locale. La ricostruzione pesante non c’è ancora.

Interfaccia in italiano, pensata prima per il telefono (Android e iPhone). Accento arancio RAL 2008.

## Cosa fa adesso

- Elenco rilievi, nuovo rilievo, scheda rilievo
- Acquisizione con la fotocamera posteriore: scatto manuale o automatico (1 s / 2 s)
- Scarto sul dispositivo di foto mosse o troppo simili; avviso se si ruota sul posto invece di fare un passo
- Mappa di copertura dalle direzioni già fotografate, pellicola delle foto accettate, consigli di ripresa
- Segni nominati sulle foto (stesso punto su più scatti) e distanze note in millimetri
- Esportazione ZIP: foto originali in ordine (`foto/001.jpg`…) e `project.json`
- PWA: dopo il primo caricamento le pagine già viste funzionano anche senza rete

Le foto restano in IndexedDB sul dispositivo. Non servono variabili d’ambiente.

## Struttura

```
app/                  Next.js (radice: Vercel builda da qui)
components/           schermate
lib/data/             repository: oggi IndexedDB, domani Supabase
lib/capture/          fotocamera, selettore, orientamento
lib/export/           ZIP
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

Su Vercel il progetto è **siderio-vcad**, build dalla radice, nessun env. La cartella `worker/` è in `.vercelignore`.

## Limiti di questa versione

- Nessun caricamento, nessun job, nessun viewer 3D reale: sono segnaposto
- La mappa di copertura usa bussola e inclinazione, non una ricostruzione
- Su iPhone lo scatto a piena risoluzione dipende da ciò che Safari concede allo stream video (`ImageCapture` lì di solito non c’è)
- Senza permesso ai sensori la mappa resta vuota; le foto si salvano lo stesso
