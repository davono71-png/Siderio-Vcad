import type { CSSProperties, DetailedHTMLProps, HTMLAttributes } from "react";

type ModelViewerProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string;
  poster?: string;
  alt?: string;
  loading?: "auto" | "lazy" | "eager";
  scale?: string;
  exposure?: string;
  crossorigin?: "anonymous" | "use-credentials" | "";
  "camera-controls"?: boolean;
  "touch-action"?: string;
  "interaction-prompt"?: "auto" | "none" | "when-focused";
  "shadow-intensity"?: string;
  "environment-image"?: string;
  style?: CSSProperties;
};

declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        "model-viewer": ModelViewerProps;
      }
    }
  }
}

export {};
