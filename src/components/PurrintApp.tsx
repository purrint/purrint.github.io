import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { drawText, splitText } from "canvas-txt";
import { renderImage } from "../services/render.ts";
import { printImage } from "../services/printer.ts";
import icon from "../assets/icon.svg";

const WIDTH = 384;
const FONT_FAMILY = `"IBM VGA 9x16", "Courier New", Courier, monospace`;
const FONT_SIZE = 16;
const LINE_HEIGHT_RATIO = 1.15;

type Mode = "image" | "text";

export default function PurrintApp() {
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);

  const [photoImageData, setPhotoImageData] = useState<ImageData>();
  const [isBluetoothAvailable] = useState("bluetooth" in navigator);
  const [mode, setMode] = useState<Mode>("image");
  const [textInput, setTextInput] = useState("");

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
    const measuredHeight = textareaElement.scrollHeight;
    textareaElement.style.height = `${measuredHeight}px`;
  }, [mode, textInput]);

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
    if (mode !== "image" || !photoImageData || !previewCanvas.current) return;
    const canvas = previewCanvas.current;
    canvas.width = photoImageData.width;
    canvas.height = photoImageData.height;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(photoImageData, 0, 0);
  }, [mode, photoImageData]);

  async function onPrintClick() {
    if (mode === "text") {
      if (!textInput.trim()) {
        alert("Please enter some text first.");
        return;
      }

      try {
        const imageData = await renderTextToCanvas(
          textInput,
          previewCanvas.current!
        );
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
      <img src={icon} className="mascot shadow" alt="PURRINT" />

      {!isBluetoothAvailable && (
        <div className="compatibility-notice">
          PURRINT works only on Android and desktop Chrome-based browsers.
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
            mode === "image" ? () => imageInput.current?.click() : undefined
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
              <u>Select image</u>
              <br />
              (or paste or drop here)
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

async function renderTextToCanvas(
  text: string,
  canvas: HTMLCanvasElement
): Promise<ImageData> {
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  const lines = splitText({ ctx, text, justify: false, width: WIDTH });
  canvas.width = WIDTH;
  const lineHeightPx = FONT_SIZE * LINE_HEIGHT_RATIO;
  canvas.height = Math.max(lines.length, 1) * lineHeightPx;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  drawText(ctx, text, {
    x: 0,
    y: 0,
    width: canvas.width,
    fontSize: FONT_SIZE,
    height: canvas.height,
    font: FONT_FAMILY,
    lineHeight: lineHeightPx,
    align: "left",
    vAlign: "top",
  });
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
