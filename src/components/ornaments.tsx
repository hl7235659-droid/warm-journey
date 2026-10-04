export function Branch({ flip }: { flip?: boolean }) {
  return (
    <img
      className={`branch${flip ? ' branch-flip' : ''}`}
      src="/images/ornament-branch.png"
      alt=""
      aria-hidden="true"
    />
  );
}

export function Corners({ bottom }: { bottom?: boolean }) {
  const pos = bottom ? ['corner-bl', 'corner-br'] : ['corner-tl', 'corner-tr'];
  return (
    <>
      <img className={`corner ${pos[0]}`} src="/images/corner-flourish.png" alt="" aria-hidden="true" />
      <img className={`corner ${pos[1]}`} src="/images/corner-flourish.png" alt="" aria-hidden="true" />
    </>
  );
}

export function Swoosh() {
  return (
    <svg className="swoosh" viewBox="0 0 250 16" aria-hidden="true" fill="none">
      <path pathLength={1} d="M6 10 C 70 3, 165 2, 244 7" stroke="var(--gold-500)" strokeWidth="5" strokeLinecap="round" />
      <path pathLength={1} d="M16 13 C 92 8, 176 7, 232 11" stroke="var(--red-600)" strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}
