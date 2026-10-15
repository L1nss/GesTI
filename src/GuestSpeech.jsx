import { motion, useReducedMotion } from "motion/react";
import GuestMascot from "./GuestMascot.jsx";
import { Icon } from "./shared.jsx";

export default function GuestSpeech({ message, paperLabel = "OI", variant = "tip", onDismiss }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.aside
      aria-label="Dica do Guest"
      aria-live="polite"
      className={`guest-speech guest-speech--${variant}`}
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
      role="status"
    >
      <motion.div
        aria-hidden="true"
        className="guest-speech-avatar"
        animate={reduceMotion ? undefined : { y: [0, -2, 0] }}
        transition={reduceMotion ? undefined : { duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
      >
        <GuestMascot className="guest-speech-mascot" paperLabel={paperLabel} />
      </motion.div>
      <div className="guest-speech-copy">
        <div className="guest-speech-heading"><strong>Guest</strong><span>SEU GUIA</span></div>
        <p>{message}</p>
      </div>
      {onDismiss && <button aria-label="Dispensar dica do Guest" className="guest-speech-dismiss" onClick={onDismiss} type="button"><Icon name="close" size={16} /></button>}
    </motion.aside>
  );
}
