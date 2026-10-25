"use client";

/**
 * The Chalky cursor: a teacher's hand over the board. An SVG overlay, laid over
 * the board area, that points at, circles, or sweeps between elements already
 * drawn, driven by a gesture script and a clock (speech time in the real app).
 * It never draws anything new; it only shows where Chalky's attention is.
 *
 * The cursor's position is a pure function of the clock, so seeking, pausing
 * and replaying all just work: each gesture starts from wherever the previous
 * one left the hand (or where it was at the moment of the cut-in).
 */
import { useEffect, useMemo, useRef, useState } from "react";


/** An element's box on the board's 100x100 grid (x right, y down). */
export interface GridBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** point: rest beside it. circle: orbit it once. sweep: travel along it or to another. underline: a stroke under it. tap: two quick pulses, "this one". */
export type CursorGestureKind = "point" | "circle" | "sweep" | "underline" | "tap";

export interface CursorStep {
  /** Clock time (seconds) the gesture starts. */
  t: number;
  target: string;
  gesture: CursorGestureKind;
  /** For sweep: the element to travel to. Omitted: along `target`'s extent. */
  to?: string;
}

export interface ChalkyCursorProps {
  boxes: Record<string, GridBox>;
  /** Pixel size of the board area the overlay covers. Omitted: measured from the overlay's own box. */
  size?: { w: number; h: number };
  script: CursorStep[];
  /** Current time in seconds (audio time in the real app). */
  clock: () => number;
  /** Seconds after the last gesture settles before the hand fades out. */
  idleFadeSeconds?: number;
  /** Visual style of the hand. */
  look?: "chalk" | "hand";
  className?: string;
}

type Pt = { x: number; y: number };

const TRAVEL = 0.45; // s, easing to a target
const ORBIT = 1.2; // s, one circle
const SWEEP = 1.0; // s, from one element to the other
const UNDERLINE = 0.9; // s, along the bottom edge
const TAP = 0.5; // s, two pulses
const INK_FADE = 2; // s, chalk left by a circle or underline fades over this
const INK_ALPHA = 0.38;
const FADE = 0.6; // s, fade-out length
const PAD = 8; // px, distance kept from an element's outline

const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.pow(1 - u, 3));
const lerp = (a: Pt, b: Pt, u: number): Pt => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });

interface PxBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function toPx(b: GridBox, size: { w: number; h: number }): PxBox {
  return { x: (b.x / 100) * size.w, y: (b.y / 100) * size.h, w: (b.w / 100) * size.w, h: (b.h / 100) * size.h };
}

const centre = (b: PxBox): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** The point on `b`'s padded outline where a ray from its centre toward `toward` leaves it. */
function edgeToward(b: PxBox, toward: Pt): Pt {
  const c = centre(b);
  const dx = toward.x - c.x, dy = toward.y - c.y;
  const hw = b.w / 2 + PAD, hh = b.h / 2 + PAD;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { x: c.x, y: b.y + b.h + PAD };
  const t = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Where the hand comes to rest when pointing at `b`, arriving from `from`. */
function restPoint(b: PxBox, from: Pt): Pt {
  const inside = from.x > b.x - PAD && from.x < b.x + b.w + PAD && from.y > b.y - PAD && from.y < b.y + b.h + PAD;
  return edgeToward(b, inside ? { x: centre(b).x, y: b.y + b.h + 100 } : from);
}

export interface CursorPose {
  p: Pt;
  /** 0..1 */
  opacity: number;
  /** Rest pulse phase, 0 when moving. */
  pulse: number;
  /** Which gesture is active (index into the script), -1 none. */
  step: number;
  /** "travel" while easing, "orbit"/"sweep" while performing, "rest" after, "idle" before anything. */
  phase: "idle" | "travel" | "orbit" | "sweep" | "underline" | "tap" | "rest";
  /** 0..1 while tapping: drives the two pulses. */
  tap: number;
  /** The chalk a circle or underline leaves: the path so far and its opacity (fading after). */
  ink: { pts: Pt[]; opacity: number } | null;
}

/** How long gesture `s` takes from its start until the hand rests. */
function duration(s: CursorStep): number {
  switch (s.gesture) {
    case "point":
      return TRAVEL;
    case "circle":
      return TRAVEL + ORBIT;
    case "underline":
      return TRAVEL + UNDERLINE;
    case "tap":
      return TRAVEL + TAP;
    default:
      return TRAVEL + SWEEP;
  }
}

/** A soft, deterministic drift so a resting hand still breathes. */
function drift(t: number, amount = 2.2): Pt {
  return { x: Math.sin(t * 1.3) * amount + Math.sin(t * 0.47) * amount * 0.6, y: Math.cos(t * 1.1) * amount * 0.8 + Math.sin(t * 0.71) * amount * 0.5 };
}

/**
 * The hand's pose at `t`, given the script sorted by time and the boxes in
 * pixels. Pure; the recursion follows the chain of starting positions.
 */
export function poseAt(t: number, script: CursorStep[], boxes: Record<string, PxBox>, size: { w: number; h: number }, idleFade: number): CursorPose {
  const home: Pt = { x: size.w * 0.92, y: size.h * 1.05 }; // just off the bottom-right, where a hand would come from
  // The active gesture: the last one that has started and whose target exists.
  let i = -1;
  for (let k = 0; k < script.length; k++) if (script[k].t <= t && boxes[script[k].target]) i = k;
  if (i < 0) return { p: home, opacity: 0, pulse: 0, step: -1, phase: "idle", tap: 0, ink: null };

  /** The hand's position (no drift) at time `at` while gesture `k` owns it. */
  const posIn = (k: number, at: number): Pt => {
    const s = script[k];
    const b = boxes[s.target];
    // Where this gesture starts from: the previous gesture's position at this one's start time.
    let prev = -1;
    for (let j = k - 1; j >= 0; j--) if (script[j].t <= s.t && boxes[script[j].target]) { prev = j; break; }
    const from = prev >= 0 ? posIn(prev, s.t) : home;
    const u = (at - s.t) / TRAVEL;
    if (s.gesture === "point" || s.gesture === "tap") {
      const rest = restPoint(b, from);
      return lerp(from, rest, ease(u));
    }
    if (s.gesture === "underline") {
      // A stroke just under the element, left to right, like a teacher underlining a word.
      const y = b.y + b.h + PAD * 0.7;
      const a1: Pt = { x: b.x - 2, y }, a2: Pt = { x: b.x + b.w + 2, y };
      if (u < 1) return lerp(from, a1, ease(u));
      const v = Math.min(1, (at - s.t - TRAVEL) / UNDERLINE);
      const e = v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2;
      return { x: a1.x + (a2.x - a1.x) * e, y: y + Math.sin(e * Math.PI) * 1.5 };
    }
    if (s.gesture === "circle") {
      const c = centre(b);
      const rx = b.w / 2 + PAD * 1.5, ry = b.h / 2 + PAD * 1.5;
      const a0 = Math.atan2(from.y - c.y, (from.x - c.x) * (ry / rx) || 1e-9);
      const entry: Pt = { x: c.x + rx * Math.cos(a0), y: c.y + ry * Math.sin(a0) };
      if (u < 1) return lerp(from, entry, ease(u));
      const v = Math.min(1, (at - s.t - TRAVEL) / ORBIT);
      const a = a0 + v * v * (3 - 2 * v) * Math.PI * 2; // one orbit, easing in and out
      return { x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) };
    }
    // sweep
    const toBox = s.to ? boxes[s.to] : undefined;
    let a1: Pt, a2: Pt;
    if (toBox) {
      a1 = edgeToward(b, centre(toBox));
      a2 = edgeToward(toBox, centre(b));
    } else if (b.w >= b.h) {
      a1 = { x: b.x - PAD, y: b.y + b.h / 2 };
      a2 = { x: b.x + b.w + PAD, y: b.y + b.h / 2 };
    } else {
      a1 = { x: b.x + b.w / 2, y: b.y - PAD };
      a2 = { x: b.x + b.w / 2, y: b.y + b.h + PAD };
    }
    if (u < 1) return lerp(from, a1, ease(u));
    const v = Math.min(1, (at - s.t - TRAVEL) / SWEEP);
    // Ease in and out, with a slight arc so it reads as a hand moving, not a slider.
    const e = v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2;
    const p = lerp(a1, a2, e);
    const nx = -(a2.y - a1.y), ny = a2.x - a1.x;
    const len = Math.hypot(nx, ny) || 1;
    const bow = Math.sin(e * Math.PI) * Math.min(18, len * 0.08);
    return { x: p.x + (nx / len) * bow, y: p.y + (ny / len) * bow };
  };

  const s = script[i];
  const since = t - s.t;
  const dur = duration(s);
  const p = posIn(i, t);
  const resting = since >= dur;
  const phase: CursorPose["phase"] = !resting
    ? since < TRAVEL
      ? "travel"
      : s.gesture === "circle"
        ? "orbit"
        : s.gesture === "underline" || s.gesture === "tap"
          ? s.gesture
          : "sweep"
    : "rest";
  const tap = s.gesture === "tap" && since >= TRAVEL && since < dur ? (since - TRAVEL) / TAP : 0;
  // Chalk: a circle or underline leaves its stroke behind, fading once it is done.
  let ink: CursorPose["ink"] = null;
  if ((s.gesture === "circle" || s.gesture === "underline") && since > TRAVEL) {
    const upto = Math.min(since, dur);
    const pts: Pt[] = [];
    for (let k = 0; k <= 36; k++) pts.push(posIn(i, s.t + TRAVEL + ((upto - TRAVEL) * k) / 36));
    const opacity = since <= dur ? INK_ALPHA : Math.max(0, INK_ALPHA * (1 - (since - dur) / INK_FADE));
    if (opacity > 0) ink = { pts, opacity };
  }
  const restFor = resting ? since - dur : 0;
  const d = resting ? drift(t, 1.5 + Math.min(2, restFor * 0.4)) : { x: 0, y: 0 };
  // Fade in over the first travel, out after idleFade seconds of rest.
  const fadeIn = Math.min(1, since / 0.25);
  const fadeOut = restFor > idleFade ? Math.max(0, 1 - (restFor - idleFade) / FADE) : 1;
  return { p: { x: p.x + d.x, y: p.y + d.y }, opacity: fadeIn * fadeOut, pulse: resting ? restFor : 0, step: i, phase, tap, ink };
}

export default function ChalkyCursor({ boxes, size, script, clock, idleFadeSeconds = 4, look = "chalk", className }: ChalkyCursorProps) {
  const host = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const glyph = useRef<SVGGElement>(null);
  const trail = useRef<SVGPolylineElement>(null);
  const inkRef = useRef<SVGPolylineElement>(null);
  const history = useRef<Pt[]>([]);
  /** Degrees the chalk leans into its motion, eased frame to frame. */
  const lean = useRef(0);

  // Measure our own box when no size is given (and keep it current on resize).
  useEffect(() => {
    if (size || !host.current) return;
    const el = host.current;
    const update = () => setMeasured({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  const px = size ?? measured ?? { w: 0, h: 0 };
  const sorted = useMemo(() => [...script].sort((a, b) => a.t - b.t), [script]);
  const pxBoxes = useMemo(() => Object.fromEntries(Object.entries(boxes).map(([id, b]) => [id, toPx(b, px)])), [boxes, px.w, px.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // Animate: every frame, read the clock and place the hand. No React state on the hot path.
  const latest = useRef({ sorted, pxBoxes, px, clock, idleFadeSeconds });
  latest.current = { sorted, pxBoxes, px, clock, idleFadeSeconds };
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const { sorted, pxBoxes, px, clock, idleFadeSeconds } = latest.current;
      const g = glyph.current;
      if (!g || !px.w) return;
      const pose = poseAt(Math.max(0, clock()), sorted, pxBoxes, px, idleFadeSeconds);
      // Two quick pulses for a tap; a slow breath while resting.
      const scale = pose.tap > 0 ? 1 + Math.abs(Math.sin(pose.tap * Math.PI * 2)) * 0.28 : 1 + (pose.pulse ? Math.sin(pose.pulse * Math.PI * 1.6) * 0.06 + 0.03 : 0);
      const ink = inkRef.current;
      if (ink) {
        ink.setAttribute("points", pose.ink ? pose.ink.pts.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ") : "");
        ink.setAttribute("opacity", pose.ink ? pose.ink.opacity.toFixed(3) : "0");
      }
      // Lean the chalk into the way it is moving (a little), and back upright at rest.
      const h0 = history.current;
      const vx = h0.length > 1 ? pose.p.x - h0[h0.length - 1].x : 0;
      const want = pose.phase === "rest" || pose.phase === "idle" ? 0 : Math.max(-16, Math.min(16, vx * 1.4));
      lean.current += (want - lean.current) * 0.18;
      g.setAttribute("transform", `translate(${pose.p.x.toFixed(1)} ${pose.p.y.toFixed(1)}) rotate(${lean.current.toFixed(2)}) scale(${scale.toFixed(3)})`);
      g.setAttribute("opacity", pose.opacity.toFixed(3));
      g.dataset.phase = pose.phase;
      g.dataset.step = String(pose.step);
      g.dataset.target = pose.step >= 0 ? sorted[pose.step].target : "";
      g.dataset.board = `${Math.round(px.w)}x${Math.round(px.h)}`;
      // A short fading trail while the hand moves; it collapses while resting.
      const h = history.current;
      if (pose.opacity > 0 && pose.phase !== "rest" && pose.phase !== "idle") h.push(pose.p);
      else if (h.length) h.shift();
      if (h.length > 14) h.shift();
      trail.current?.setAttribute("points", h.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" "));
      trail.current?.setAttribute("opacity", String(Math.min(0.5, h.length / 14) * pose.opacity));
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={host} className={className} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }} data-testid="chalky-cursor">
      {px.w > 0 && (
        <svg width={px.w} height={px.h} viewBox={`0 0 ${px.w} ${px.h}`} style={{ position: "absolute", inset: 0, overflow: "visible", display: "block" }} aria-hidden>
          <defs>
            <radialGradient id="chalky-cursor-glow">
              <stop offset="0%" stopColor="#E4572E" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#E4572E" stopOpacity="0" />
            </radialGradient>
            <filter id="chalky-cursor-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="1.5" dy="2.5" stdDeviation="1.6" floodColor="#1F2A44" floodOpacity="0.28" />
            </filter>
          </defs>
          <polyline ref={inkRef} fill="none" stroke="#E4572E" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0" data-testid="chalky-cursor-ink" />
          <polyline
            ref={trail}
            fill="none"
            stroke={look === "chalk" ? "#292722" : "#E4572E"}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={look === "chalk" ? "1 6" : undefined}
            opacity="0"
          />
          <g ref={glyph} opacity="0" data-testid="chalky-cursor-glyph">
            {look === "hand" && <circle r="22" fill="url(#chalky-cursor-glow)" />}
            {look === "chalk" ? (
              // The lower-left writing tip stays at the gesture's origin.
              <image href="/cursors/chalk-09.png" x="-19" y="-55.5" width="90" height="60" />
            ) : (
              // A soft pointing hand, fingertip at the origin.
              <g filter="url(#chalky-cursor-shadow)" transform="rotate(-20) translate(0 2)">
                <path d="M 0 0 C -4 4 -6 10 -5 18 L -5 34 Q -5 42 4 44 L 20 44 Q 30 44 32 34 L 33 22 Q 33 16 28 16 L 26 16 Q 26 10 20 10 L 19 10 Q 18 4 12 4 L 10 4 L 7 -1 Q 4 -5 0 0 Z" fill="#F6D9C3" stroke="#C98B6B" strokeWidth="1.3" strokeLinejoin="round" />
                <path d="M 10 4 L 10 14 M 19 10 L 19 16 M 26 16 L 26 20" stroke="#C98B6B" strokeWidth="1.1" strokeLinecap="round" fill="none" />
              </g>
            )}
            {look === "hand" && <circle r="3.2" fill="#E4572E" />}
          </g>
        </svg>
      )}
    </div>
  );
}
