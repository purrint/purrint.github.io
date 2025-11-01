import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { renderImage } from "../services/render.ts";
import { printImage } from "../services/printer.ts";
import icon from "../assets/icon.svg";

const PREVIEW_WIDTH = 384;
const TEXT_PADDING = 16;
const TEXT_FONT_SIZE = 16;
const TEXT_LINE_HEIGHT = 1.4;
const TEXT_PRIMARY_FONT = "IBM VGA 9x16";
const TEXT_FONT_FAMILY = `"${TEXT_PRIMARY_FONT}", "Courier New", Courier, monospace`;
const MIN_TEXT_HEIGHT = 120;
const TEXT_THRESHOLD = 200;

type Mode = "image" | "text";

export default function PurrintApp() {
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);

  const [photoImageData, setPhotoImageData] = useState<ImageData>();
  const [isBluetoothAvailable] = useState("bluetooth" in navigator);
  const [mode, setMode] = useState<Mode>("image");
  const [textInput, setTextInput] = useState("");

  const printableText = useMemo(
    () => normalizeTextForPrinting(textInput),
    [textInput]
  );

  function handleFile(file: File) {
    if (!previewCanvas.current) {
      return;
    }
    renderImage(file, previewCanvas.current)
      .then((imageData) => {
        setPhotoImageData(imageData);
      })
      .catch((error) => {
        console.error("Rendering failed:", error);
        alert("Rendering failed. See console for details.");
      });
  }

  function onImageInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) {
      handleFile(event.target.files[0]);
    }
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.dataTransfer?.files.length) {
      handleFile(event.dataTransfer.files[0]);
    }
  }

  useLayoutEffect(() => {
    if (mode !== "text" || !textArea.current) {
      return;
    }
    const textareaElement = textArea.current;
    textareaElement.style.height = "auto";
    const measuredHeight = Math.max(
      textareaElement.scrollHeight,
      MIN_TEXT_HEIGHT
    );
    textareaElement.style.height = `${measuredHeight}px`;
  }, [mode, printableText]);

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      for (const item of Array.from(event.clipboardData?.items ?? [])) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            handleFile(file);
            return;
          }
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  useEffect(() => {
    if (mode !== "image" || !photoImageData || !previewCanvas.current) {
      return;
    }

    const canvas = previewCanvas.current;
    canvas.width = photoImageData.width;
    canvas.height = photoImageData.height;
    const ctx = canvas.getContext("2d", {
      willReadFrequently: true,
    })!;
    ctx.putImageData(photoImageData, 0, 0);
  }, [mode, photoImageData]);

  async function onPrintClick() {
    if (mode === "text") {
      if (!printableText.trim()) {
        alert("Please enter some text first.");
        return;
      }

      const canvas = previewCanvas.current;
      const textareaElement = textArea.current;

      if (!canvas || !textareaElement) {
        alert("Unable to render text. Please try again.");
        return;
      }

      const contentHeight = Math.max(
        textareaElement.scrollHeight,
        MIN_TEXT_HEIGHT
      );

      try {
        const imageData = await renderTextToCanvas({
          text: printableText,
          canvas,
          width: PREVIEW_WIDTH,
          height: contentHeight,
          fontSize: TEXT_FONT_SIZE,
          lineHeight: TEXT_LINE_HEIGHT,
          fontFamily: TEXT_FONT_FAMILY,
          padding: TEXT_PADDING,
          threshold: TEXT_THRESHOLD,
        });
        await printImage(imageData);
      } catch (error) {
        console.error("Printing failed:", error);
        alert("Printing failed. See console for details.");
      }

      return;
    }

    if (!photoImageData) {
      alert("Please select an image first.");
      return;
    }

    try {
      await printImage(photoImageData);
    } catch (error) {
      console.error("Printing failed:", error);
      alert("Printing failed. See console for details.");
    }
  }

  return (
    <>
      <img
        src={icon}
        className="mascot shadow"
        alt="PURRINT"
        height="150"
        width="150"
      />

      {!isBluetoothAvailable && (
        <div className="compatibility-notice">
          Bluetooth is not available in this browser.<br />Try a Chrome-based
          browser instead.
        </div>
      )}

      <div className="mode-toggle">
        <button
          type="button"
          className={mode === "image" ? "active" : ""}
          onClick={() => setMode("image")}
        >
          Image
        </button>
        <button
          type="button"
          className={mode === "text" ? "active" : ""}
          onClick={() => setMode("text")}
        >
          Text
        </button>
      </div>

      <div className="receipt">
        <div
          id="preview-container"
          className={[
            mode === "image" && photoImageData ? "has-image" : "",
            mode === "text" ? "text-mode" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={
            mode === "image"
              ? () => imageInput.current?.click()
              : undefined
          }
          onDrop={mode === "image" ? onDrop : undefined}
          onDragOver={
            mode === "image"
              ? (event) => {
                  event.preventDefault();
                }
              : undefined
          }
        >
          {mode === "image" && (
            <div id="preview-text">
              Select image<br />(or paste or drop here)
            </div>
          )}

          {mode === "text" && (
            <textarea
              ref={textArea}
              className="text-input"
              placeholder="Type your message here…"
              value={textInput}
              onChange={(event) => setTextInput(event.target.value)}
            />
          )}

          <canvas
            id="preview"
            ref={previewCanvas}
            style={mode === "text" ? { display: "none" } : undefined}
          ></canvas>
        </div>
      </div>

      <input
        type="file"
        id="image-input"
        accept="image/*"
        style={{ display: "none" }}
        ref={imageInput}
        onChange={onImageInputChange}
      />
      <button
        id="print-button"
        onClick={onPrintClick}
        disabled={!isBluetoothAvailable}
      >
        PURRINT!
      </button>
    </>
  );
}

function normalizeTextForPrinting(value: string): string {
  return value.replace(/\t/g, "    ");
}

async function renderTextToCanvas(options: {
  text: string;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  padding: number;
  threshold: number;
}): Promise<ImageData> {
  const {
    text,
    canvas,
    width,
    height,
    fontSize,
    lineHeight,
    fontFamily,
    padding,
    threshold,
  } = options;

  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  })!;

  const fontDeclaration = `${fontSize}px ${fontFamily}`;
  await ensureFontLoaded(`${fontSize}px "${TEXT_PRIMARY_FONT}"`);
  context.font = fontDeclaration;
  const maxWidth = Math.max(1, width - padding * 2);
  const charWidth = context.measureText("M").width || fontSize * 0.6;
  const maxCharsPerLine = Math.max(1, Math.floor(maxWidth / charWidth));

  const lines = wrapMonospaceText(text, maxCharsPerLine);
  const lineHeightPx = fontSize * lineHeight;
  const requiredHeight = Math.max(
    height,
    padding * 2 + lines.length * lineHeightPx
  );

  canvas.width = width;
  canvas.height = Math.ceil(requiredHeight);

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true,
  })!;

  ctx.font = fontDeclaration;
  ctx.textBaseline = "top";
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#000";
  lines.forEach((line, index) => {
    const y = padding + index * lineHeightPx;
    ctx.fillText(line, padding, y);
  });

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const luminance = data[i];
    const value = luminance < threshold ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  ctx.putImageData(imageData, 0, 0);
  return imageData;
}

async function ensureFontLoaded(fontDeclaration: string): Promise<void> {
  if (typeof document === "undefined") {
    return;
  }

  const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fontSet?.load) {
    return;
  }

  try {
    await fontSet.load(fontDeclaration);
  } catch {
    // Ignore load failures and fall back to system fonts.
  }
}

function wrapMonospaceText(value: string, maxCharsPerLine: number): string[] {
  const limit = Math.max(1, maxCharsPerLine);
  const normalized = value.replace(/\r\n/g, "\n");
  const lines: string[] = [];
  let currentLine = "";
  let column = 0;
  let lastBreakColumn = -1;
  let lastBreakIndex = -1;

  function pushCurrentLine() {
    lines.push(currentLine);
    currentLine = "";
    column = 0;
    lastBreakColumn = -1;
    lastBreakIndex = -1;
  }

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (char === "\n") {
      pushCurrentLine();
      continue;
    }

    currentLine += char;
    column += 1;

    if (char === " " || char === "\t" || char === "-") {
      lastBreakColumn = column;
      lastBreakIndex = currentLine.length;
    }

    if (column >= limit) {
      if (lastBreakColumn > 0 && lastBreakColumn < column) {
        const breakIndex = lastBreakIndex;
        const linePart = currentLine.slice(0, breakIndex);
        lines.push(linePart);
        currentLine = currentLine.slice(breakIndex);
        column = currentLine.length;

        lastBreakColumn = -1;
        lastBreakIndex = -1;
        for (let j = 0; j < currentLine.length; j++) {
          const c = currentLine[j];
          if (c === " " || c === "\t" || c === "-") {
            lastBreakColumn = j + 1;
            lastBreakIndex = j + 1;
          }
        }
      } else {
        lines.push(currentLine);
        currentLine = "";
        column = 0;
        lastBreakColumn = -1;
        lastBreakIndex = -1;
      }
    }
  }

  lines.push(currentLine);
  return lines;
}
