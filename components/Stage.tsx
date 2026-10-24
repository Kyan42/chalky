"use client";

import { createPlayer, type PlayerHandle } from "@clayzo/webgl-player";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { loadDocument, loadersFor, type PlayableSegment } from "@/lib/clayzo/assets";
import { CANVAS } from "@/lib/types";

export type StageHandle = {
  play: () => void;
  pause: () => void;
  seek: (tick: number) => Promise<void>;
  tick: () => number;
  playing: () => boolean;
  /** The canvas currently on screen, for snapshots. */
  canvas: () => HTMLCanvasElement | null;
};

export type StageClip = {
  /** Changing the key loads a new player; the previous one stays visible until the new one draws. */
  key: string;
  segment: PlayableSegment;
  startTick: number;
  autoplay: boolean;
  /** Pause here (once) and call onStop: the end-of-chapter question. */
  stopAtTick?: number;
};

type Props = {
  clip: StageClip | null;
  onTick?: (tick: number) => void;
  onStop?: (tick: number) => void;
  onEnded?: () => void;
  onError?: (error: Error) => void;
  children?: React.ReactNode;
};

type Layer = StageClip & { player: PlayerHandle | null; canvas: HTMLCanvasElement | null };

/**
 * The 16:9 stage. Plays one Clayzo segment at a time and reports its clock. Swapping clips is
 * seamless: the new player is created underneath and the old one is removed only once the new
 * one has drawn its first frame (which, for a detour, is the same frame).
 */
export const Stage = forwardRef<StageHandle, Props>(function Stage({ clip, onTick, onStop, onEnded, onError, children }, ref) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const active = useRef<Layer | null>(null);
  const callbacks = useRef({ onTick, onStop, onEnded, onError });
  useEffect(() => {
    callbacks.current = { onTick, onStop, onEnded, onError };
  });

  useEffect(() => {
    if (!clip) return;
    // A new clip becomes a new layer underneath; it replaces the old one once it draws.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayers((current) => (current.some((l) => l.key === clip.key) ? current : [...current, { ...clip, player: null, canvas: null }]));
  }, [clip]);

  const onReady = useCallback((key: string, player: PlayerHandle, canvas: HTMLCanvasElement) => {
    setLayers((current) => {
      const layer = current.find((l) => l.key === key);
      if (!layer) {
        player.dispose();
        return current;
      }
      for (const old of current) if (old.key !== key) old.player?.dispose();
      const ready = { ...layer, player, canvas };
      active.current = ready;
      return [ready];
    });
  }, []);

  // The clock: watch the active player's tick for the stop point and the end.
  useEffect(() => {
    let frame = 0;
    let stopped: string | null = null;
    let ended: string | null = null;
    const loop = () => {
      const layer = active.current;
      if (layer?.player) {
        const tick = layer.player.tick;
        callbacks.current.onTick?.(tick);
        if (layer.stopAtTick !== undefined && stopped !== layer.key && tick >= layer.stopAtTick) {
          stopped = layer.key;
          layer.player.pause();
          callbacks.current.onStop?.(tick);
        }
        const last = layer.segment.durationTicks - 8;
        if (ended !== layer.key && tick >= last && !layer.player.playing) {
          ended = layer.key;
          callbacks.current.onEnded?.();
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => layers.forEach((l) => l.player?.dispose()), []); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(
    ref,
    () => ({
      play: () => active.current?.player?.play(),
      pause: () => active.current?.player?.pause(),
      seek: async (tick) => {
        await active.current?.player?.seek(tick);
      },
      tick: () => active.current?.player?.tick ?? 0,
      playing: () => active.current?.player?.playing ?? false,
      canvas: () => active.current?.canvas ?? null,
    }),
    [],
  );

  return (
    <div className="stage relative w-full overflow-hidden rounded-2xl bg-[#0E1020] shadow-2xl" style={{ aspectRatio: `${CANVAS.width} / ${CANVAS.height}` }}>
      {layers.map((layer, index) => (
        <PlayerLayer key={layer.key} layer={layer} onTop={index === 0} onReady={onReady} onError={(e) => callbacks.current.onError?.(e)} />
      ))}
      {children}
    </div>
  );
});

function PlayerLayer({
  layer,
  onTop,
  onReady,
  onError,
}: {
  layer: Layer;
  onTop: boolean;
  onReady: (key: string, player: PlayerHandle, canvas: HTMLCanvasElement) => void;
  onError: (error: Error) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { key, segment, startTick, autoplay } = layer;

  useEffect(() => {
    let disposed = false;
    let player: PlayerHandle | null = null;
    (async () => {
      if (!segment.documentUrl) throw new Error("This animation has no document");
      const document = await loadDocument(segment.documentUrl);
      if (disposed || !canvasRef.current) return;
      player = await createPlayer({
        canvas: canvasRef.current,
        document,
        loaders: loadersFor(segment.assets),
        loop: false,
        muted: false,
        interactive: false,
        releaseWhenOffscreen: false,
        maxPixelRatio: 2,
        onError,
      });
      if (disposed) return player.dispose();
      await player.seek(startTick);
      if (autoplay) player.play();
      onReady(key, player, canvasRef.current);
    })().catch((e) => onError(e instanceof Error ? e : new Error(String(e))));
    return () => {
      disposed = true;
    };
    // The layer is immutable for its key.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ zIndex: onTop ? 1 : 0 }} />;
}
