/**
 * Hand a file to the player (M45, as M49's save export does): on a phone or tablet whose browser can
 * share files, the share sheet (a group chat, Photos, Files); elsewhere, or if sharing is refused, a
 * download. Says which happened ('cancelled' when the player closed the share sheet).
 */
export async function shareOrDownload(
  blob: Blob,
  name: string,
  title: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const touch = typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0;
  if (touch && typeof File === 'function' && navigator.canShare) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return 'shared';
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/** A city's name as a file name. */
export const fileName = (city: string, rest: string) =>
  `${city.replace(/[^a-z0-9-_]+/gi, '_') || 'city'}-${rest}`;
