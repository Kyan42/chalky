/**
 * Test-only helpers: read back what a WebGL player actually drew, so spikes and
 * the browser run can measure the wave instead of trusting the player's
 * reported tick.
 */

/** Copies the WebGL canvas into a 2D canvas. Call right after a draw, in the same task. */
export function snapshot(canvas: HTMLCanvasElement): ImageData | null {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext("2d", { willReadFrequently: true });
  if (!ctx || canvas.width === 0) return null;
  ctx.drawImage(canvas, 0, 0);
  return ctx.getImageData(0, 0, copy.width, copy.height);
}

/**
 * The rightmost column, as a fraction of the width, holding an "ink" pixel
 * (reddish: the wave colour #E4572E). 0 when nothing is drawn.
 */
export function inkExtent(image: ImageData | null): number {
  if (!image) return -1;
  const { data, width, height } = image;
  let right = -1;
  for (let y = 0; y < height; y += 2) {
    for (let x = width - 1; x > right; x--) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 180 && g < 140 && b < 120) {
        right = x;
        break;
      }
    }
  }
  return right < 0 ? 0 : (right + 1) / width;
}
