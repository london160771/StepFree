import { motion } from 'framer-motion';

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/**
 * Short opening title over the city as it builds underneath. Purely visual and non-blocking:
 * it ignores pointer events and the same words live on the About page.
 */
export function Intro({ leaving }: { leaving: boolean }) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 bottom-[42%] z-20 flex items-center justify-center px-6 lg:bottom-0 lg:left-[440px]"
      initial={false}
      animate={leaving ? { opacity: 0, y: -28, scale: 0.94 } : { opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: EASE_OUT }}
    >
      <motion.div
        className="absolute h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.92),rgba(255,255,255,0))] lg:h-[28rem] lg:w-[28rem]"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
      />
      <div className="relative text-center">
        <motion.p
          className="text-5xl font-bold tracking-tight text-slate-900 sm:text-6xl lg:text-7xl"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
        >
          Step<span className="text-teal-700">Free</span>
        </motion.p>
        <motion.p
          className="mx-auto mt-3 max-w-xs text-lg font-medium leading-snug text-slate-600 sm:max-w-md lg:text-2xl"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5, ease: EASE_OUT }}
        >
          The shortest route isn’t useful if you can’t use it.
        </motion.p>
      </div>
    </motion.div>
  );
}
