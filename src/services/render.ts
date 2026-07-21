export async function renderImage(
  file: File,
  previewCanvas: HTMLCanvasElement,
  width = 384
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const newWidth = width;
        const newHeight = Math.floor(img.height * (newWidth / img.width));

        previewCanvas.width = newWidth;
        previewCanvas.height = newHeight;

        const ctx = previewCanvas.getContext("2d", {
          willReadFrequently: true,
        })!;

        ctx.drawImage(img, 0, 0, newWidth, newHeight);

        const imageData = ctx.getImageData(0, 0, newWidth, newHeight);
        dither(imageData);
        ctx.putImageData(imageData, 0, 0);
        resolve(imageData);
      };
      img.onerror = reject;
      img.src = event.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function dither(imageData: ImageData) {
  const { data, width, height } = imageData;
  const grayscale = new Float32Array(width * height);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    grayscale[i / 4] = gray;
    min = Math.min(min, gray);
    max = Math.max(max, gray);
  }

  // Normalize to full 0-255 range
  const range = max - min;
  if (range > 0) {
    for (let i = 0; i < grayscale.length; i++) {
      grayscale[i] = ((grayscale[i] - min) / range) * 255;
    }
  }

  // Atkinson dithering
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const oldPixel = grayscale[index];
      const newPixel = oldPixel > 128 ? 255 : 0;
      grayscale[index] = newPixel;
      const error = (oldPixel - newPixel) / 8;

      if (x + 1 < width) {
        grayscale[index + 1] += error;
      }
      if (x + 2 < width) {
        grayscale[index + 2] += error;
      }
      if (x - 1 >= 0 && y + 1 < height) {
        grayscale[index - 1 + width] += error;
      }
      if (y + 1 < height) {
        grayscale[index + width] += error;
      }
      if (x + 1 < width && y + 1 < height) {
        grayscale[index + 1 + width] += error;
      }
      if (y + 2 < height) {
        grayscale[index + width * 2] += error;
      }
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    const color = grayscale[i / 4];
    data[i] = color;
    data[i + 1] = color;
    data[i + 2] = color;
  }
}
