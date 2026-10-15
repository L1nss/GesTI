import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import GuestMascot from "./GuestMascot.jsx";

export default function LoginWelcome({ onComplete }) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState(() => reduceMotion ? "welcome" : "printing");

  useEffect(() => {
    const timers = [];
    if (reduceMotion) {
      timers.push(window.setTimeout(() => setPhase("fade"), 2200));
      timers.push(window.setTimeout(onComplete, 2600));
    } else {
      timers.push(window.setTimeout(() => setPhase("catching"), 950));
      timers.push(window.setTimeout(() => setPhase("throwing"), 1650));
      timers.push(window.setTimeout(() => setPhase("welcome"), 2350));
      timers.push(window.setTimeout(() => setPhase("fade"), 4300));
      timers.push(window.setTimeout(onComplete, 4700));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [onComplete, reduceMotion]);

  return (
    <div aria-atomic="true" aria-live="polite" className={`login-welcome login-welcome--${phase}`} role="status">
      <div className="login-welcome-stage">
        <div className="login-welcome-scene"><GuestMascot className="login-welcome-guest" mode="print" /></div>
        <div className="login-welcome-paper">
          <span className="login-welcome-brand">Gesti</span>
          <div className="login-welcome-message">
            <GuestMascot className="login-welcome-portrait" />
            <h1>Bem-vindo(a)!</h1>
            <p>Que bom ter você de volta. Sua tela inicial está pronta.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
