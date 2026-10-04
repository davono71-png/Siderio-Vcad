"use client";

import { useEffect } from "react";
import { startUploader } from "@/lib/upload/runner";

/** Starts the background R2 queue once for the whole app. */
export function UploadManager() {
  useEffect(() => {
    startUploader();
  }, []);
  return null;
}
