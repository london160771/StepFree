export function LiftGlyph({ unavailable = false, className = '' }: { unavailable?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden>
      <rect x="1.5" y="1.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.5 8.5 10 4.5l3.5 4z" fill="currentColor" />
      <path d="M6.5 11.5 10 15.5l3.5-4z" fill="currentColor" />
      {unavailable && <path d="M2 18 18 2" stroke="currentColor" strokeWidth="2" />}
    </svg>
  );
}

export function CheckGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden>
      <path d="m4.5 10.5 3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function InfoGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden>
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 9v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="6.2" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function LocationGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden>
      <path
        d="M10 18s5.5-5.2 5.5-9.5a5.5 5.5 0 0 0-11 0C4.5 12.8 10 18 10 18z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="8.5" r="2" fill="currentColor" />
    </svg>
  );
}
