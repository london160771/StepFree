import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { INTRO } from '../map/timeline';

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;
const WORD = [...'StepFree'];

/**
 * Opening scene: Westminster at dusk with the StepFree wordmark and tagline. When `leaving`
 * turns on, the photo warms into the map's ground colour and dissolves while the map
 * underneath zooms out and builds. It never blocks taps; only the Skip button is interactive.
 *
 * Photo: "Big Ben and Westminster Bridge at dusk" (CC0, Wikimedia Commons).
 */
export function Intro({ leaving, onSkip }: { leaving: boolean; onSkip: () => void }) {
  const [canSkip, setCanSkip] = useState(false);
  const [photoReady, setPhotoReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setCanSkip(true), INTRO.skipAfterMs);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <motion.div
        aria-hidden
        className="absolute inset-0 overflow-hidden bg-[#161a22]"
        initial={{ opacity: 0 }}
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={leaving ? { duration: 1.4, ease: EASE_IN_OUT, delay: 0.15 } : { duration: 0.8, ease: 'easeOut' }}
      >
        {/* Slow push-in on the photo; on leaving it settles back as it dissolves. */}
        <motion.picture
          className="absolute inset-0 block"
          style={{ opacity: photoReady ? 1 : 0, transition: 'opacity 0.9s ease-out' }}
          initial={{ scale: 1.14, x: '1.5%' }}
          animate={leaving ? { scale: 1.02, x: '0%' } : { scale: 1.06, x: '0%' }}
          transition={{ duration: leaving ? 1.5 : 7.4, ease: EASE_OUT }}
        >
          <source media="(max-width: 767px)" srcSet="/intro/westminster-dusk-720.webp" />
          <img
            src="/intro/westminster-dusk-1600.webp"
            alt=""
            className="h-full w-full object-cover"
            decoding="async"
            fetchPriority="high"
            onLoad={() => setPhotoReady(true)}
            ref={(img) => {
              if (img?.complete && img.naturalWidth > 0) setPhotoReady(true);
            }}
          />
        </motion.picture>
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-950/15 to-slate-950/55" />
        {/* Warms toward the map's ground colour so the photo dissolves into the map, not to black. */}
        <motion.div
          className="absolute inset-0 bg-[var(--map-ground)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: leaving ? 0.9 : 0 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
      </motion.div>

      <motion.div
        aria-hidden
        className="absolute inset-x-0 top-[12%] px-6 text-center lg:left-auto lg:right-[7%] lg:top-[11%] lg:text-right"
        animate={leaving ? { opacity: 0, y: -56, scale: 0.88 } : { opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.75, ease: EASE_OUT }}
      >
        <p className="text-6xl font-bold tracking-tight text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.45)] sm:text-7xl lg:text-8xl">
          {WORD.map((char, i) => (
            <motion.span
              key={i}
              className={`inline-block ${i >= 4 ? 'text-teal-300' : ''}`}
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 + i * 0.055, duration: 0.6, ease: EASE_OUT }}
            >
              {char}
            </motion.span>
          ))}
        </p>
        <motion.div
          className="mx-auto mt-4 h-1 w-24 origin-left rounded-full bg-teal-300/90 lg:mr-0 lg:origin-right"
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ delay: 1.1, duration: 0.7, ease: EASE_OUT }}
        />
        <motion.p
          className="mx-auto mt-5 max-w-xs text-balance lg:mr-0 text-xl font-medium leading-snug text-white/95 drop-shadow-[0_1px_10px_rgba(0,0,0,0.5)] sm:max-w-md lg:max-w-xl lg:text-3xl"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5, duration: 0.8, ease: EASE_OUT }}
        >
          The shortest route isn’t useful if you can’t use it.
        </motion.p>
      </motion.div>

      {canSkip && !leaving && (
        <motion.button
          type="button"
          onClick={onSkip}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="pointer-events-auto absolute bottom-[max(env(safe-area-inset-bottom),1.5rem)] right-5 min-h-11 rounded-full bg-white/15 px-5 text-base font-semibold text-white ring-1 ring-white/40 backdrop-blur transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-300/60"
        >
          Skip intro
        </motion.button>
      )}
    </div>
  );
}
