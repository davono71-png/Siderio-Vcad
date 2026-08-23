import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AssetRecord, PenPrefs, Survey } from "../models/types";

const DB_NAME = "siderio-vcad";
const DB_VERSION = 1;

interface VcadDb extends DBSchema {
  surveys: {
    key: string;
    value: Survey;
    indexes: { "by-updated": string };
  };
  assets: {
    key: string;
    value: AssetRecord & { blob: Blob };
    indexes: { "by-survey": string };
  };
  settings: {
    key: string;
    value: { key: string; penPrefs?: PenPrefs };
  };
}

let dbPromise: Promise<IDBPDatabase<VcadDb>> | null = null;

export function getDb(): Promise<IDBPDatabase<VcadDb>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB non disponibile"));
  }
  if (!dbPromise) {
    dbPromise = openDB<VcadDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("surveys")) {
          const surveys = db.createObjectStore("surveys", { keyPath: "id" });
          surveys.createIndex("by-updated", "updatedAt");
        }
        if (!db.objectStoreNames.contains("assets")) {
          const assets = db.createObjectStore("assets", { keyPath: "id" });
          assets.createIndex("by-survey", "surveyId");
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}
