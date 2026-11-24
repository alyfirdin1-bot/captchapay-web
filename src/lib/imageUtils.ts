/**
 * Compresses an image file from mobile gallery/camera or file picker
 * to a lightweight Data URL (WebP, PNG, or JPEG) suitable for storing in Firestore settings.
 */
const IMAGE_EXT_REGEX = /\.(png|jpe?g|webp|gif|svg|bmp|avif|heic|heif)$/i;

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('ছবি ডিকোড করা সম্ভব হয়নি।'));
    img.src = src;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const result = e.target?.result;
      if (typeof result === 'string' && result.startsWith('data:')) {
        resolve(result);
      } else {
        reject(new Error('ফাইল পড়তে ব্যর্থ হয়েছে।'));
      }
    };
    reader.onerror = () => reject(new Error('ফাইল পড়তে ব্যর্থ হয়েছে।'));
    reader.readAsDataURL(file);
  });
}

function encodeCanvasCompact(
  img: HTMLImageElement,
  maxDimension: number,
  quality: number
): string {
  const natW = img.naturalWidth || img.width || maxDimension;
  const natH = img.naturalHeight || img.height || maxDimension;
  let width = natW;
  let height = natH;

  if (width >= height) {
    if (width > maxDimension) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    }
  } else {
    if (height > maxDimension) {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('ক্যানভাস তৈরি করা যায়নি।');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  try {
    const webpData = canvas.toDataURL('image/webp', quality);
    if (webpData.startsWith('data:image/webp')) {
      return webpData;
    }
  } catch {
    // fallback below
  }

  // Fallback to white-backed JPEG (avoids transparent PNG turning black)
  const jpegCanvas = document.createElement('canvas');
  jpegCanvas.width = canvas.width;
  jpegCanvas.height = canvas.height;
  const jCtx = jpegCanvas.getContext('2d');
  if (jCtx) {
    jCtx.fillStyle = '#ffffff';
    jCtx.fillRect(0, 0, jpegCanvas.width, jpegCanvas.height);
    jCtx.drawImage(canvas, 0, 0);
    try {
      const jpegData = jpegCanvas.toDataURL('image/jpeg', quality);
      if (jpegData.startsWith('data:image/jpeg')) {
        return jpegData;
      }
    } catch {
      // fallback to png
    }
  }

  return canvas.toDataURL('image/png');
}

export async function compressImageToDataUrl(
  file: File,
  maxDimension = 240,
  quality = 0.84
): Promise<string> {
  const mime = (file.type || '').toLowerCase();
  const looksLikeImageByMime = mime.startsWith('image/');
  const looksLikeImageByName = IMAGE_EXT_REGEX.test(file.name || '');

  // Some mobile gallery pickers provide empty file.type ("") or application/octet-stream
  if (mime && !looksLikeImageByMime && mime !== 'application/octet-stream' && !looksLikeImageByName) {
    throw new Error('দয়া করে সঠিক ছবি ফাইল (PNG, JPG, WebP) নির্বাচন করুন।');
  }

  let img: HTMLImageElement;
  let objectUrl: string | null = null;

  try {
    objectUrl = URL.createObjectURL(file);
    img = await loadImageElement(objectUrl);
  } catch {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    const rawDataUrl = await readFileAsDataUrl(file);
    img = await loadImageElement(rawDataUrl);
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }

  // Try progressively smaller outputs if image data URL exceeds ~85KB so Firestore settings doc stays compact
  let dataUrl = encodeCanvasCompact(img, maxDimension, quality);
  if (dataUrl.length > 85_000) {
    dataUrl = encodeCanvasCompact(img, Math.min(maxDimension, 180), 0.72);
  }
  if (dataUrl.length > 85_000) {
    dataUrl = encodeCanvasCompact(img, 140, 0.62);
  }
  if (dataUrl.length > 140_000) {
    throw new Error('ছবির সাইজ অনেক বড়। অনুগ্রহ করে আরও ছোট একটি লোগো বা স্ক্রিনশট ব্যবহার করুন।');
  }

  return dataUrl;
}
