const PLAYER_RUNTIME_ID = "hyperframes-player-runtime";
const PLAYER_RUNTIME_SRC = "https://cdn.jsdelivr.net/npm/@hyperframes/player";

function ensurePlayerRuntime() {
  if (typeof document === "undefined") return;
  if (document.getElementById(PLAYER_RUNTIME_ID)) return;

  const script = document.createElement("script");
  script.id = PLAYER_RUNTIME_ID;
  script.type = "module";
  script.src = PLAYER_RUNTIME_SRC;
  document.head.appendChild(script);
}

export function HyperframesPreview({
  src,
  poster,
  aspectRatio = "16 / 9",
  className = "",
  playerClassName = "",
  children,
}) {
  React.useEffect(() => {
    ensurePlayerRuntime();
  }, []);

  const wrapperClassName =
    `not-prose relative overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800 ${className}`.trim();
  const resolvedPlayerClassName = `block h-full w-full ${playerClassName}`.trim();

  return (
    <div className={wrapperClassName} style={{ aspectRatio }}>
      <hyperframes-player
        src={src}
        poster={poster}
        autoplay
        muted
        loop
        playsInline
        className={resolvedPlayerClassName}
        style={{ width: "100%", height: "100%" }}
      />
      {children}
    </div>
  );
}
