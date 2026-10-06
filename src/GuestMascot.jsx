export default function GuestMascot({ mode = "idle", gaze = 0, className = "" }) {
  const pupilX = Math.max(-1, Math.min(1, Number(gaze) || 0)) * 4;
  const modifier = mode === "email" ? " guest-mascot--email" : mode === "password" ? " guest-mascot--password" : mode === "eject" ? " guest-mascot--eject" : mode === "retract" ? " guest-mascot--retract" : "";

  return (
    <span aria-hidden="true" className={`guest-mascot${modifier}${className ? ` ${className}` : ""}`}>
      <svg fill="none" viewBox="0 0 220 205">
        <ellipse cx="110" cy="190" fill="#07393c" opacity=".16" rx="58" ry="9" />
        <g className="guest-paper-out">
          <path d="M78 65V29c0-4 3-7 7-7h50c4 0 7 3 7 7v36" fill="#fff" stroke="#4f8e8e" strokeWidth="3" />
          <path d="M91 37h37m-37 9h37m-37 9h27" stroke="#a7c7c5" strokeLinecap="round" strokeWidth="3" />
        </g>
        <path d="M109 57V43" stroke="#2c666e" strokeLinecap="round" strokeWidth="5" />
        <circle className="guest-signal" cx="109" cy="38" r="7" fill="#90ddf0" />
        <path d="M43 91c-12 0-19 8-19 19s7 19 19 19m134-38c12 0 19 8 19 19s-7 19-19 19" fill="#c9e6e2" stroke="#2c666e" strokeWidth="4" />
        <path d="M42 79c0-12 9-21 21-21h94c12 0 21 9 21 21v78c0 13-9 22-22 22H64c-13 0-22-9-22-22V79Z" fill="#eff5f2" stroke="#4b8584" strokeWidth="4" />
        <path d="M49 77c0-9 7-15 16-15h90c9 0 16 6 16 15v13H49V77Z" fill="#d6e7e3" />
        <rect x="61" y="91" width="98" height="57" rx="17" fill="#07393c" />
        <g className="guest-eye guest-eye-left" style={{ transform: `translateX(${pupilX}px)` }}>
          <ellipse cx="91" cy="114" rx="9" ry="11" fill="#d8ffff" />
          <ellipse cx="93" cy="115" rx="4" ry="5" fill="#123e40" />
        </g>
        <g className="guest-eye guest-eye-right" style={{ transform: `translateX(${pupilX}px)` }}>
          <ellipse cx="129" cy="114" rx="9" ry="11" fill="#d8ffff" />
          <ellipse cx="131" cy="115" rx="4" ry="5" fill="#123e40" />
        </g>
        <path className="guest-smile" d="M101 132c5 5 13 5 18 0" stroke="#90ddf0" strokeLinecap="round" strokeWidth="3" />
        <path d="M54 157h94" stroke="#4b8584" strokeLinecap="round" strokeWidth="5" />
        <rect x="85" y="166" width="49" height="8" rx="4" fill="#9dbab6" />
        <circle cx="154" cy="166" r="4" fill="#5ca9a5" />
        <g className="guest-arm guest-arm-left">
          <path d="M45 107c-15 1-17 18-7 27l25 8" stroke="#2c666e" strokeLinecap="round" strokeWidth="10" />
          <path d="M54 132c-2-5 1-10 6-12l7-3c5-2 10 1 11 5l2 6c1 4-1 8-5 10l-7 3c-5 2-10 0-12-4l-2-5Z" fill="#d6e7e3" stroke="#2c666e" strokeLinejoin="round" strokeWidth="3" />
          <path d="m63 124 8 10m-13-4 8 9" stroke="#90bcb8" strokeLinecap="round" strokeWidth="2" />
        </g>
        <g className="guest-arm guest-arm-right">
          <path d="M175 107c15 1 17 18 7 27l-25 8" stroke="#2c666e" strokeLinecap="round" strokeWidth="10" />
          <path d="M166 132c2-5-1-10-6-12l-7-3c-5-2-10 1-11 5l-2 6c-1 4 1 8 5 10l7 3c5 2 10 0 12-4l2-5Z" fill="#d6e7e3" stroke="#2c666e" strokeLinejoin="round" strokeWidth="3" />
          <path d="m157 124-8 10m13-4-8 9" stroke="#90bcb8" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
      {className.includes("auth-mascot") && <span>Guest</span>}
    </span>
  );
}
