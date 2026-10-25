/** Keep the current spoken sentence, splitting long sentences into short caption pages. */
export function captionWindow(words: string[], activeIndex: number, pageSize = 14) {
  if (!words.length || activeIndex < 0) return [];
  const end = Math.min(activeIndex, words.length - 1);
  let start = 0;
  for (let i = 0; i < end; i++) {
    if (/[.!?]["'”’)]*$/.test(words[i])) start = i + 1;
  }
  start += Math.floor((end - start) / pageSize) * pageSize;
  return words.slice(start, end + 1).map((word, offset) => ({ word, index: start + offset }));
}
