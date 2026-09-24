interface MinoMarkProps {
  className?: string;
  title?: string;
}

export default function MinoMark({ className = "h-7 w-7", title = "Mino" }: MinoMarkProps) {
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${className}`} title={title}>
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
    </span>
  );
}
