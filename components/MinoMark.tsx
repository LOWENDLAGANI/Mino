"use client";

import { useState } from "react";

interface MinoMarkProps {
  className?: string;
  title?: string;
  /** Path to the logo inside /public. Falls back to the built-in mark if missing. */
  src?: string;
}

function SparkleMark({ className, title }: { className: string; title: string }) {
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full overflow-visible" role="img" aria-label={title}>
      <defs>
        <linearGradient id="mino-mark" x1="8" y1="6" x2="40" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9ee7ff" />
          <stop offset="0.45" stopColor="#8b7cf6" />
          <stop offset="1" stopColor="#5b4bd6" />
        </linearGradient>
        <filter id="mino-mark-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3.2" result="blur" />
          <feFlood floodColor="#7567e8" floodOpacity="0.45" />
          <feComposite in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        d="M24 3.5c2.3 9.3 4.7 11.7 14 14-9.3 2.3-11.7 4.7-14 14-2.3-9.3-4.7-11.7-14-14 9.3-2.3 11.7-4.7 14-14Z"
        fill="url(#mino-mark)"
        filter="url(#mino-mark-glow)"
      />
      <path
        d="M15.5 29.5V18l8.5 7 8.5-7v11.5"
        fill="none"
        stroke="#09090b"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3.2"
      />
    </svg>
  );
}

export default function MinoMark({ className = "h-7 w-7", title = "Mino", src = "/mino-logo.png" }: MinoMarkProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${className}`} title={title}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={title}
          className="h-full w-full object-contain"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <SparkleMark className={className} title={title} />
      )}
    </span>
  );
}
