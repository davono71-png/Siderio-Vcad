import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function I(props: IconProps) {
  const { title, children, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={!title}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconPen = (p: IconProps) => (
  <I {...p}>
    <path d="M4 20l4.5-1.2L19 8.3a2.1 2.1 0 0 0-3-3L5.5 15.8 4 20z" />
  </I>
);
export const IconHighlighter = (p: IconProps) => (
  <I {...p}>
    <path d="M5 19h14" />
    <path d="M7 19l3-9 4 2-1.2 7" />
    <path d="M13 8l3-3 3 3-3 3" />
  </I>
);
export const IconFountain = (p: IconProps) => (
  <I {...p}>
    <path d="M12 3v6" />
    <path d="M8 9c0 2.2 1.8 4 4 4s4-1.8 4-4" />
    <path d="M12 13v4" />
    <path d="M8 21h8l-1.5-4h-5L8 21z" />
  </I>
);
export const IconPencil = (p: IconProps) => (
  <I {...p}>
    <path d="M4 20h4L18 10l-4-4L4 16v4z" />
    <path d="M12 8l4 4" />
  </I>
);
export const IconEraser = (p: IconProps) => (
  <I {...p}>
    <path d="M5 15l6 6 9-9-6-6-9 9z" />
    <path d="M8 18h12" />
  </I>
);
export const IconUndo = (p: IconProps) => (
  <I {...p}>
    <path d="M8 8H4v4" />
    <path d="M4 12a8 8 0 1 0 2.2-5.6L4 8" />
  </I>
);
export const IconRedo = (p: IconProps) => (
  <I {...p}>
    <path d="M16 8h4v4" />
    <path d="M20 12a8 8 0 1 1-2.2-5.6L20 8" />
  </I>
);
export const IconCamera = (p: IconProps) => (
  <I {...p}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4V8z" />
    <circle cx="12" cy="13" r="3.2" />
  </I>
);
export const IconImage = (p: IconProps) => (
  <I {...p}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.4" />
    <path d="M4 16l5-4 4 3 3-2 4 3" />
  </I>
);
export const IconPlus = (p: IconProps) => (
  <I {...p}>
    <path d="M12 5v14M5 12h14" />
  </I>
);
export const IconZoomIn = (p: IconProps) => (
  <I {...p}>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-3.5-3.5M8 11h6M11 8v6" />
  </I>
);
export const IconFit = (p: IconProps) => (
  <I {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </I>
);
export const IconSave = (p: IconProps) => (
  <I {...p}>
    <path d="M5 5h11l3 3v11H5V5z" />
    <path d="M8 5v5h8V5M8 19v-6h8v6" />
  </I>
);
export const IconMore = (p: IconProps) => (
  <I {...p}>
    <circle cx="6" cy="12" r="1.3" fill="currentColor" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <circle cx="18" cy="12" r="1.3" fill="currentColor" />
  </I>
);
export const IconRuler = (p: IconProps) => (
  <I {...p}>
    <path d="M4 16l12-12 4 4-12 12H4v-4z" />
    <path d="M9 11l2 2M12 8l2 2" />
  </I>
);
export const IconSelect = (p: IconProps) => (
  <I {...p}>
    <path d="M5 4l6 16 2-6 6-2L5 4z" />
  </I>
);
export const IconCheck = (p: IconProps) => (
  <I {...p}>
    <path d="M5 12l5 5 9-10" />
  </I>
);
export const IconBack = (p: IconProps) => (
  <I {...p}>
    <path d="M15 5l-7 7 7 7" />
  </I>
);
export const IconCad = (p: IconProps) => (
  <I {...p}>
    <path d="M4 18V6l8-3 8 3v12l-8 3-8-3z" />
    <path d="M12 3v18M4 6l8 3 8-3" />
  </I>
);
export const IconTrash = (p: IconProps) => (
  <I {...p}>
    <path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" />
  </I>
);
export const IconDuplicate = (p: IconProps) => (
  <I {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
  </I>
);
export const IconRename = (p: IconProps) => (
  <I {...p}>
    <path d="M4 20h16M6 16l9-9 3 3-9 9H6v-3z" />
  </I>
);
export const IconOpen = (p: IconProps) => (
  <I {...p}>
    <path d="M5 12V6h14v12H9" />
    <path d="M5 16l7-4 3 6" />
  </I>
);
