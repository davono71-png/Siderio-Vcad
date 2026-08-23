import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

const SHOTS = [
  {
    src: "/mockups/mockup-home-taccuini.png",
    title: "Home — taccuini",
    body: "Ogni rilievo è un taccuino. Apertura, rinomina, duplica ed elimina restano a un tocco.",
  },
  {
    src: "/mockups/mockup-editor-penna.png",
    title: "Editor — foto e inchiostro",
    body: "La penna disegna su un livello diverso dalla fotografia. Gomma e undo non toccano lo scatto originale.",
  },
  {
    src: "/mockups/mockup-editor-dwg.png",
    title: "Editor — DWG/DXF e quote",
    body: "Il CAD resta in sola lettura. Quote e appunti a penna stanno su un layer sopra, senza sporcare il file.",
  },
  {
    src: "/mockups/mockup-fold-cover-inner.png",
    title: "Galaxy Z Fold8 Ultra",
    body: "Cover stretta 21:9 per sfogliare i taccuini; schermo interno ~10:9 con lista pagine e foglio di lavoro.",
  },
];

export default function MockupPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Logo />
        <Link href="/" className="btn-secondary">
          Apri l’app
        </Link>
      </div>
      <h1 className="font-serif text-3xl">Mockup V1</h1>
      <p className="mb-8 max-w-2xl text-ink/65">
        Direzione visiva del taccuino da sopralluogo: carta, inchiostro e comandi
        grandi. L’app vera è già collegata a IndexedDB e funziona offline.
      </p>
      <div className="grid gap-8">
        {SHOTS.map((shot) => (
          <figure key={shot.src} className="overflow-hidden rounded-3xl bg-white shadow-lg">
            <Image
              src={shot.src}
              alt={shot.title}
              width={1600}
              height={900}
              className="h-auto w-full"
            />
            <figcaption className="p-4">
              <div className="font-serif text-xl">{shot.title}</div>
              <p className="text-sm text-ink/65">{shot.body}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
