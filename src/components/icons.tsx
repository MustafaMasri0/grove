// Small original line icons, drawn for this app.
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const RepoIcon = () => (
  <svg {...base}>
    <path d="M3.5 2.5h8a1 1 0 0 1 1 1v9.5h-8.5a1.5 1.5 0 0 1 0-3h8.5" />
    <path d="M3.5 2.5v9" />
  </svg>
);

export const WorktreeIcon = () => (
  <svg {...base}>
    <rect x="2" y="3" width="5" height="4" rx="1" />
    <rect x="9" y="9" width="5" height="4" rx="1" />
    <path d="M4.5 7v3.5a.5.5 0 0 0 .5.5h4" />
  </svg>
);

export const BranchIcon = () => (
  <svg {...base}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5.5" r="1.5" />
    <path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-6.5 4" />
  </svg>
);

export const SyncIcon = ({ spin }: { spin?: boolean }) => (
  <svg {...base} className={spin ? "spin" : undefined}>
    <path d="M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5" />
    <path d="M11.8 2v2.6H9.2M4.2 14v-2.6h2.6" />
  </svg>
);

export const UpIcon = () => (
  <svg {...base}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </svg>
);

export const PublishIcon = () => (
  <svg {...base}>
    <path d="M4.5 11.5h-.5a2.5 2.5 0 0 1-.3-5A3.5 3.5 0 0 1 10.5 5a3 3 0 0 1 1.5 6.5" />
    <path d="M8 14V8.5M6 10.5l2-2 2 2" />
  </svg>
);

export const FileIcon = () => (
  <svg {...base} strokeWidth={1.2}>
    <path d="M4 2h5.5L12.5 5v8.5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5v-11A.5.5 0 0 1 4 2zM9.5 2v3h3" />
  </svg>
);

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg {...base} width={12} height={12} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .1s" }}>
    <path d="M6 4l4 4-4 4" />
  </svg>
);

export const GearIcon = () => (
  <svg {...base} strokeWidth={1.2}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    <circle cx="8" cy="8" r="4.6" />
  </svg>
);

export const TreeViewIcon = () => (
  <svg {...base} strokeWidth={1.2}>
    <path d="M2.5 3h4M5 7.5h4M5 12h4M3.5 3v9h1.5M3.5 7.5h1.5" />
    <path d="M10.5 7.5h3M10.5 12h3" />
  </svg>
);

export const ListViewIcon = () => (
  <svg {...base} strokeWidth={1.2}>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
    <path d="M2.5 4h.5M2.5 8h.5M2.5 12h.5" />
  </svg>
);
