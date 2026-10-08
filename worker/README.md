# Worker GPU (RunPod Serverless)

Questo worker ricostruisce un rilievo a partire dalle foto già caricate su Cloudflare R2 dall’app di acquisizione. Resta nella cartella `worker/` e non entra nel deploy Vercel (`.vercelignore`). Il prototipo CPU che ha prodotto il risultato della stanza da 53 foto è in `worker/prototipo/` e non va usato in produzione.

Il ramo dipende dall’app di acquisizione, pull request [#1](https://github.com/davono71-png/Siderio-Vcad/pull/1) (`cursor/rilievi-acquisizione-e0f4`). Senza quelle chiavi R2 e senza `project.json` il worker non ha ingressi. Non unire questo ramo prima della PR #1.

## Cosa produce

Per ogni `projectId` legge:

- `rilievi/<projectId>/project.json`
- `rilievi/<projectId>/foto/<seq>-<photoId>.jpg`

e scrive in `rilievi/<projectId>/risultati/`:

| file | contenuto |
|---|---|
| `status.json` | fase, percentuale, messaggi, tempi, errore |
| `walls.step` | stanza: pareti, solette e porta. Facciata: piano di fondo e superfici davanti, in millimetri (CadQuery) |
| `room_textured.glb` | mesh con texture, millimetri |
| `room_textured_obj.zip` | OBJ + MTL + PNG |
| `room_dense.ply` | nuvola densa in millimetri |
| `room.json` | stanza: Lx, Ly, H e aperture. Facciata: piani rilevati (`mode`, dimensioni, supporto, scartati) |
| `scene.json` | solo in modalità facciata, stesso contenuto di `room.json` |
| `scale_report.json` / `.md` | scala ai minimi quadrati e residui |
| `diagnostic.json` | foto registrate, pose, tempi |
| `preview_iso.png`, `preview_top.png`, `preview_plan.png` | anteprime |

La pipeline non ruota i JPEG secondo l’EXIF: le osservazioni `rawX`/`rawY` divise per il fattore di scala sono i pixel di COLMAP. `x`/`y` restano i pixel del riquadro già raddrizzato e non si usano per la triangolazione.

## Rilevamento pareti

Il guscio della stanza è il bordo esterno di pavimento e soffitto. Un piano verticale entra solo se sta su quel bordo e copre una quota vera del muro. Un armadio arretrato o un quadro non diventano la parete. Se un ambiente è ambiguo si può comunque forzare il risultato, nello stesso sistema del prototipo (`room_config.json`: unità del modello, prima dello spostamento dell’origine):

```json
{
  "projectId": "<uuid>",
  "options": {
    "roomOverrides": {"xmin": -7.57, "xmax": 5.90, "ymin": -5.61, "ymax": 6.52, "floor": -6.47, "ceiling": 5.00},
    "openingsMm": [{"wall": "N_ymax", "u0": 2189, "u1": 2958, "z0": 0, "z1": 2098, "kind": "door"}]
  }
}
```

`openingsMm` è in millimetri nel sistema finale (Z in su, origine nell’angolo xmin/ymin). `cutOpenings` vale `doors` (solo porte), `all` o `none`.

## Facciata

`options.mode` vale `stanza` (default) o `facciata`. Se `options.mode` manca, il worker legge `project.kind` da `project.json` (l’app lo scrive già: `stanza` o `facciata`). Un file senza quel campo resta una stanza.

In modalità facciata non servono pavimento né soffitto. Lo STEP non è una scatola. L'asse verticale dello STEP è **Y** (`upAxis` in `scene.json`): X corre lungo la facciata, Z punta verso la camera, la faccia visibile del muro è Z=0 e lo spessore cresce verso Z negativo. L'alto è la gravità del telefono. L'asse Y della camera la conferma solo se è d'accordo: su un JPEG verticale senza rotazione EXIF quell'asse è spesso orizzontale e non sostituisce la gravità. Un piano di terra corregge la gravità quando non torna. Prima di classificare i piani la nuvola viene ruotata così che Y sia l'alto. Il piano di fondo è la facciata verticale più estesa rivolta verso le foto, spessore `wallThicknessMm`. Un rilievo di tegole o mattoni entro circa 60 mm resta lo stesso muro. Davanti restano solo piani quasi verticali o quasi orizzontali (il terreno, se c'è, è facoltativo). Un piano inclinato entra solo se è grande e ben sostenuto; gli altri finiscono in `skipped`. Una porta (vuoto o piano arretrato) e, se il buco non tocca terra, una finestra sono aperture tagliate nella lastra di fondo. Se solo il fondo è affidabile, lo STEP contiene soltanto quello e `note` lo dice.

Se le quote si contraddicono (lasciandone una fuori l'errore supera il 5%), `diagnostic.json`, `status.json` (`warnings` e il messaggio) e il rapporto di scala riportano l'avviso.

```json
{"input": {"projectId": "<uuid>", "options": {"mode": "facciata"}}}
```

## Immagine Docker

| | |
|---|---|
| Percorso Dockerfile | `worker/Dockerfile` |
| Contesto di build | radice del repository (`.`) |
| Base | `nvidia/cuda:12.8.1` su Ubuntu 24.04 |
| GPU | RTX 4090 (sm_89) e Quadro P4000 (sm_61) |
| COLMAP | 4.2.1 compilato con CUDA, SIFT e PatchMatch |
| OpenMVS | 2.4.0 con PatchMatch CUDA |
| Python | 3.12, pacchetti fissati in `worker/requirements.txt` |

Build locale:

```bash
docker build -f worker/Dockerfile -t siderio-vcad-worker .
```

Su una macchina con poca RAM: `--build-arg BUILD_JOBS=2`. Le architetture si cambiano con `--build-arg CUDA_ARCHITECTURES=61,89` e la stessa lista va messa in `SIDERIO_CUDA_SMS` dentro l’immagine (è già il default).

L’immagine misurata è circa **10,6 GB**: il runtime CUDA pesa circa 6 GB, l’ambiente Python (Open3D e CadQuery) circa 2,9 GB, i binari e le librerie copiate meno di 0,5 GB. Su questa macchina (4 core, `BUILD_JOBS=2`) la compilazione CUDA di COLMAP è stata circa 12 minuti e quella di OpenMVS circa 8, più il pull dell’immagine base, apt e i pacchetti Python. Un build da zero sta intorno ai **40 minuti** e può superare il limite di circa 30 minuti del solo `docker build` nell’integrazione GitHub di RunPod (la finestra totale è più lunga). Se la build su RunPod viene interrotta, costruire l’immagine in locale, pubblicarla su un registry e creare l’endpoint con **Import from Docker Registry**.

`colmap -h` e `import pycolmap` partono anche senza scheda video. `DensifyPointCloud` è linkato a `libcuda.so.1`: senza il driver NVIDIA non si avvia. Su RunPod quel file lo monta il runtime della GPU.

Le wheel `pycolmap-cuda12` non vanno usate al posto di questa compilazione: i cubin ufficiali sono per sm_90, sm_100 e sm_120, quindi non girano né sulla 4090 né sulla P4000.

### Licenze

COLMAP è BSD. Open3D, CadQuery, trimesh, boto3 e l’SDK RunPod hanno licenze permissive. **OpenMVS è AGPL-3.0** e CGAL, usato da OpenMVS, include parti GPL. Entrambi sono eseguibili separati: il codice Python non li linka. Per l’uso interno va bene. Se l’immagine viene distribuita fuori dall’azienda, gli obblighi AGPL riguardano quei binari (i sorgenti sono i tag fissati nel Dockerfile: OpenMVS v2.4.0, CGAL v6.0.1). Non ci sono modelli con licenza non commerciale: il supporto ONNX di COLMAP, usato per descrittori appresi, è spento.

## Creare l’endpoint su RunPod

1. In RunPod, **Settings** e collega l’account GitHub che vede `davono71-png/Siderio-Vcad`.
2. **Serverless** → **New Endpoint**.
3. **Import Git Repository** e scegli `davono71-png/Siderio-Vcad`.
4. Branch: `cursor/worker-runpod-db32` finché la pull request non è su `main`. Dopo il merge di questa PR e della PR #1, sposta il branch su `main`.
5. **Dockerfile path**: `worker/Dockerfile`. Il contesto è la radice del repo: RunPod non va puntato alla sola cartella `worker/`, perché il Dockerfile copia `worker/...` dalla radice.
6. Tipo di endpoint: coda (**Queue**).
7. GPU: **RTX 4090, 24 GB**. Non scegliere una GPU con compute capability diversa da 8.9 o 6.1, salvo ricompilare l’immagine.
8. Worker attivi (**Active workers**): **0**. Worker massimi: **1** o **2**.
9. Idle timeout: **5 secondi**. Execution timeout: **1800 secondi** (30 minuti).
10. Container disk: **40 GB**. Il default da 5–10 GB si riempie con la nuvola densa.
11. Variabili d’ambiente (senza spazi, senza virgolette):

| variabile | valore |
|---|---|
| `R2_ACCOUNT_ID` | id account Cloudflare, 32 caratteri esadecimali |
| `R2_ACCESS_KEY_ID` | chiave S3 di R2 |
| `R2_SECRET_ACCESS_KEY` | segreto della chiave |
| `R2_BUCKET` | `siderio-vcad-foto` |

L’endpoint è `https://<account>.r2.cloudflarestorage.com`, region `auto`. Non committare questi valori.

12. Crea l’endpoint e aspetta che la build finisca. Copia l’**Endpoint ID**.

Opzionali, già impostate nell’immagine: `SIDERIO_WORK_ROOT` (`/tmp/siderio`), `SIDERIO_CUDA_SMS` (`61,89`).

## Costo indicativo

Listino RunPod Serverless Flex, luglio 2026, ancora riportato a ottobre 2026: RTX 4090 a **1,10 USD/ora**, cioè circa 0,000306 USD al secondo, arrotondato al secondo, solo mentre il worker è acceso. Con worker attivi a zero non si paga il tempo inattivo oltre i 5 secondi.

Il prototipo CPU della stanza da 53 foto ha impiegato circa 20 minuti di calcolo. Sulla 4090 lo stesso rilievo sta plausibilmente in **8–15 minuti** di GPU, più l’avvio a freddo (scaricare l’immagine). Ordine di grandezza: **0,20–0,45 USD a rilievo**, da confermare sul primo job reale. Due worker massimi possono far correre due rilievi insieme e raddoppiare quel picco.

## Come lo chiama l’app

Avvio:

```http
POST https://api.runpod.ai/v2/<endpointId>/run
Authorization: Bearer <RUNPOD_API_KEY>
Content-Type: application/json

{"input": {"projectId": "<uuid>", "options": {"downscale": 2}}}
```

La risposta contiene `id` (il job). Stato:

```http
GET https://api.runpod.ai/v2/<endpointId>/status/<jobId>
Authorization: Bearer <RUNPOD_API_KEY>
```

A job completato, `output` è il riepilogo JSON (`ok`, `registeredImages`, `scale`, `room`, `outputs`, `timingsSec`). Controllare `output.ok`: un errore di pipeline torna comunque un JSON con `ok: false`, `error` e `stage`, e lo stesso testo finisce in `risultati/status.json`. Durante il lavoro il worker aggiorna quel file e manda gli avanzamenti a RunPod (`progress`).

`options` accettate (tutte facoltative):

| chiave | default | ruolo |
|---|---|---|
| `mode` | `stanza`, oppure `project.kind` | `stanza` o `facciata` |
| `downscale` | 2 | fattore intero, come il prototipo |
| `device` | `auto` | `auto`, `cuda` o `cpu` |
| `maxFeatures` | 12000 | feature SIFT per foto |
| `seeds` | 4 | semi del mapping incrementale |
| `wallThicknessMm` | 150 | spessore pareti STEP |
| `floorSlabMm` / `ceilingSlabMm` | 150 | solette |
| `roomOverrides` | {} | piani forzati |
| `openingsMm` | [] | aperture in millimetri |
| `cutOpenings` | `doors` | `doors`, `all`, `none` |
| `mmPerUnit` | dalla scala | salta le quote dell’app |
| `resolutionLevel` | 1 | densificazione OpenMVS |
| `skipDense` | false | si ferma dopo la scala |
| `allowMissing` | false | tollera foto assenti su R2 |
| `monteCarlo` | 40 | incertezza della scala |

## Prova in locale

Senza GPU il dispositivo `auto` usa la CPU. Servono COLMAP/pycolmap, OpenMVS, Open3D e CadQuery installati, più le quattro variabili R2 se si legge dal bucket.

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r worker/requirements.txt
# pycolmap e i binari OpenMVS vanno installati a parte (li fornisce l'immagine)
python worker/test_local.py --smoke
python worker/test_local.py --project-dir ./rilievo --out ./out --device cpu --skip-dense
python worker/test_local.py --project-id <uuid> --device cpu
```

`--project-dir` legge `project.json` e le JPEG (`foto/001.jpg` oppure il nome del `r2Key`) e non carica nulla. `--project-id` scarica da R2 e carica `risultati/`.

Lo smoke test di CI non ha GPU né COLMAP: importa i moduli ed esegue scala e pareti su una stanza sintetica (pavimento, soffitto, armadio arretrato, quadro, tavolo, porta) e su tre facciate sintetiche (scrivania senza pavimento né soffitto; muro esterno inclinato; nuvola con Z in alto, come il telaio COLMAP, con l'asse della camera orizzontale, una porta e una finestra).

```bash
pip install -r worker/requirements-smoke.txt
python worker/smoke_test.py
```

Dentro l’immagine, anche senza GPU:

```bash
docker run --rm --entrypoint python siderio-vcad-worker /opt/siderio/smoke_test.py
```
