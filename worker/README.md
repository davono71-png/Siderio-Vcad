# Worker GPU

Questa cartella è il posto del worker Python che ricostruirà i rilievi. Non c’è ancora codice eseguibile: Vercel ignora la cartella (`.vercelignore`) perché il sito Next.js resta alla radice del repo.

## Ruolo

Il telefono raccoglie le foto a piena risoluzione, l’orientamento del dispositivo e le quote tra punti notevoli. Il worker, su RunPod serverless con GPU, farà la ricostruzione pesante:

- **COLMAP** — orientamento delle foto e nuvola sparsa
- **OpenMVS** — mesh densa e texture
- **Open3D** — pulizia e semplificazione
- **CadQuery** — pareti semplificate in STEP
- più avanti **gsplat** — anteprima gaussiana

## Ingressi previsti

- Foto JPEG originali, in ordine di scatto
- `project.json` esportato dall’app (pose, direzioni, punti con coordinate pixel, distanze in millimetri)

## Uscite previste

- Mesh OBJ
- Mesh GLB per l’anteprima nel browser
- STEP delle pareti semplificate

L’app mostra già le schermate di invio, stato e download, ma il collegamento (Supabase per i file, coda verso RunPod) non è implementato.
