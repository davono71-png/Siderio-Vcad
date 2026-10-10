import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DM_Sans, Source_Serif_4 } from "next/font/google";
import { AccessGate } from "@/components/auth/AccessGate";
import { RegisterSW } from "@/components/pwa/RegisterSW";
import { UploadManager } from "@/components/upload/UploadManager";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: "Siderio Vcad",
  description:
    "Rilievi fotografici di stanze e facciate. Scatta, segna le quote e prepara il modello 3D. Funziona anche senza rete dopo il primo caricamento.",
  applicationName: "Siderio Vcad",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Siderio",
  },
  icons: {
    icon: [
      { url: "/brand/siderio-icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192" },
      { url: "/icons/icon-512.png", sizes: "512x512" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2C2C2C",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="it" className={`${dmSans.variable} ${sourceSerif.variable} h-full antialiased`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var KEY="siderio-chunk-reload";function once(){if(sessionStorage.getItem(KEY)==="1")return;sessionStorage.setItem(KEY,"1");location.reload();}function broken(message){return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(String(message||""));}addEventListener("error",function(event){var target=event.target;if(target&&target.src&&String(target.src).indexOf("/_next/")!==-1){once();return;}if(broken(event.message))once();},true);addEventListener("unhandledrejection",function(event){var reason=event.reason;if(broken(reason&&(reason.message||String(reason))))once();});}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full bg-paper text-ink">
        <RegisterSW />
        <AccessGate>
          <UploadManager />
          {children}
        </AccessGate>
      </body>
    </html>
  );
}
