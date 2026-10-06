import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import GuestMascot from "./GuestMascot.jsx";

export default function LoginWelcome({ onComplete }) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState(() => reduceMotion ? "welcome" : "printing");

  useEffect(() => {
    const timers = [];
    if (reduceMotion) {
      timers.push(window.setTimeout(() => setPhase("fade"), 1100));
      timers.push(window.setTimeout(onComplete, 1450));
    } else {
      timers.push(window.setTimeout(() => setPhase("unfolding"), 520));
      timers.push(window.setTimeout(() => setPhase("welcome"), 1580));
      timers.push(window.setTimeout(() => setPhase("fade"), 2720));
      timers.push(window.setTimeout(onComplete, 3220));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [onComplete, reduceMotion]);

  return (
    <div aria-atomic="true" aria-live="polite" className={`login-welcome login-welcome--${phase}`} role="status">
      <div className="login-welcome-stage">
        <GuestMascot className="login-welcome-guest" mode="eject" />
        <div className="login-welcome-paper">
          <span className="login-welcome-brand">GesTI</span>
          <div className="login-welcome-message">
            <h1>Bem-vindo!</h1>
            <p>Sua tela inicial está pronta.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
