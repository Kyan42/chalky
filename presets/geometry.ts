// Small helpers for writing preset shapes as SVG path strings.

export type P = [number, number];

/** A point on the cubic p0 → p3 at t. */
export function cubicAt(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

const n = (v: number) => +v.toFixed(1);

/** "M x y L x y …" through the points, closed with Z when asked. */
export function poly(points: P[], close = false): string {
  return points.map((p, i) => `${i ? "L" : "M"}${n(p[0])} ${n(p[1])}`).join(" ") + (close ? " Z" : "");
}

/** A smooth curve through the points (Catmull-Rom as cubics), closed into a loop when asked. */
export function smooth(points: P[], close = false, tension = 1): string {
  const pts = close ? [points[points.length - 1], ...points, points[0], points[1]] : [points[0], ...points, points[points.length - 1]];
  let d = `M${n(pts[1][0])} ${n(pts[1][1])}`;
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
    const c1: P = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2: P = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += ` C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(p2[0])} ${n(p2[1])}`;
  }
  return close ? d + " Z" : d;
}

/** A closed blob: `count` points around (cx, cy) at radius r, each pushed out by `bumps[i]` (fraction of r). */
export function blob(cx: number, cy: number, rx: number, ry: number, bumps: number[], turn = 0): string {
  const pts: P[] = bumps.map((b, i) => {
    const a = turn + (i / bumps.length) * Math.PI * 2;
    return [cx + Math.cos(a) * rx * (1 + b), cy + Math.sin(a) * ry * (1 + b)];
  });
  return smooth(pts, true);
}

/** A sine wave from (x0, y) to (x1, y), as a smooth curve. */
export function wave(x0: number, x1: number, y: number, amp: number, cycles: number, phase = 0): string {
  const steps = Math.max(8, Math.round(cycles * 8));
  const pts: P[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([x0 + (x1 - x0) * t, y + amp * Math.sin(phase + t * cycles * Math.PI * 2)]);
  }
  return smooth(pts);
}

/** A closed ellipse turned `deg` degrees clockwise about its centre. */
export function oval(cx: number, cy: number, rx: number, ry: number, deg = 0): string {
  const a = (deg * Math.PI) / 180;
  const pts: P[] = [];
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    const x = Math.cos(t) * rx, y = Math.sin(t) * ry;
    pts.push([cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]);
  }
  return smooth(pts, true);
}

/** A pill (stadium) from (x0, y0) to (x1, y1), `r` wide on each side of the line. */
export function pill(x0: number, y0: number, x1: number, y1: number, r: number): string {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const pts: P[] = [];
  for (const [cx, cy, from] of [[x1, y1, a - Math.PI / 2], [x0, y0, a + Math.PI / 2]] as const) {
    for (let i = 0; i <= 6; i++) {
      const t = from + (i / 6) * Math.PI;
      pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
    }
  }
  return smooth(pts, true, 0.9);
}
