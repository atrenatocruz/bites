export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h };
  const k = max / longest;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

type Source = Blob | HTMLVideoElement;

async function toDrawable(src: Source): Promise<{ draw: CanvasImageSource; w: number; h: number; release: () => void }> {
  if (src instanceof HTMLVideoElement) {
    return { draw: src, w: src.videoWidth, h: src.videoHeight, release: () => {} };
  }
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(src, { imageOrientation: "from-image" });
      return { draw: bmp, w: bmp.width, h: bmp.height, release: () => bmp.close() };
    } catch {
      // fall through to <img> decoding
    }
  }
  const url = URL.createObjectURL(src);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { draw: img, w: img.naturalWidth, h: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

function encode(draw: CanvasImageSource, sw: number, sh: number, max: number, type: string, quality: number): string {
  const { w, h } = fitWithin(sw, sh, max);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(draw, 0, 0, w, h);
  return canvas.toDataURL(type, quality);
}

export async function compressImage(src: Source): Promise<{ base64: string; thumb: string }> {
  const { draw, w, h, release } = await toDrawable(src);
  try {
    if (!w || !h) throw new Error("empty image");
    const jpeg = encode(draw, w, h, 1024, "image/jpeg", 0.8);
    let thumb = encode(draw, w, h, 240, "image/webp", 0.6);
    if (!thumb.startsWith("data:image/webp")) thumb = encode(draw, w, h, 240, "image/jpeg", 0.6);
    return { base64: jpeg.slice(jpeg.indexOf(",") + 1), thumb };
  } finally {
    release();
  }
}
