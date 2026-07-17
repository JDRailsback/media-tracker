// Nocturne starfield — a sparse scatter of 1px pinpricks fixed to the
// viewport, dark theme only. Deliberately NOT glowing: each star is a hard
// sub-2px radial stop at low opacity, texture rather than light source.
// Light mode renders nothing — stars don't show in daylight, and the paper
// canvas stays clean. Purely visual: aria-hidden and non-interactive.
const STARS: [number, number, number, number][] = [
  // [x%, y%, size(px), opacity]
  [12, 18, 1, 0.5],
  [27, 41, 1, 0.28],
  [33, 64, 1, 0.32],
  [48, 27, 1.5, 0.4],
  [56, 12, 1.5, 0.4],
  [63, 55, 1, 0.24],
  [71, 43, 1, 0.28],
  [79, 88, 1, 0.3],
  [87, 76, 1, 0.38],
  [44, 89, 1.5, 0.26],
  [92, 22, 1, 0.3],
  [8, 84, 1, 0.3],
  [18, 60, 1, 0.22],
  [97, 52, 1, 0.26],
];

const STARFIELD = STARS.map(
  ([x, y, size, alpha]) =>
    `radial-gradient(${size}px ${size}px at ${x}% ${y}%, rgb(199 214 246 / ${alpha}) 49%, transparent 51%)`
).join(", ");

export default function AmbientBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 hidden dark:block"
      style={{ backgroundImage: STARFIELD }}
    />
  );
}
