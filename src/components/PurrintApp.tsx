import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { marked } from "marked";
import { toCanvas } from "html-to-image";
import { dither, renderImage } from "../services/render.ts";
import { printImage } from "../services/printer.ts";
import icon from "../assets/icon.svg";

const WIDTH = 384;
const FONT_SIZE = 16;
const LINE_HEIGHT_RATIO = 1.15;

type Mode = "image" | "text";

export default function PurrintApp() {
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);

  const [photoImageData, setPhotoImageData] = useState<ImageData>();
  const [textImageData, setTextImageData] = useState<ImageData>();
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

  async function insertImageFile(file: File) {
    try {
      const canvas = document.createElement("canvas");
      // WIDTH-1 = render content width (1px caret padding), so the dithered
      // bitmap is never rescaled and survives the final dither untouched
      await renderImage(file, canvas, WIDTH - 1);
      const markdown = `![](${canvas.toDataURL("image/png")})`;
      if (textImageData) {
        setTextImageData(undefined);
        setTextInput((value) => `${value}\n${markdown}`);
      } else {
        textArea.current?.focus();
        document.execCommand("insertText", false, markdown);
      }
    } catch (error) {
      console.error("Image conversion failed:", error);
      alert("Image conversion failed. See console for details.");
    }
  }

  function onTextKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    const { selectionStart, selectionEnd, value } = event.currentTarget;
    if (selectionStart !== selectionEnd) return;
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const line = value.slice(lineStart, selectionStart);
    const marker = line.match(/^(\s*)(?:(\d+)([.)])[ \t]+|([-*+])[ \t]+)?/)!;
    const [matched, indent, number, delimiter, bullet] = marker;
    if (matched === "") return;
    event.preventDefault();
    if ((number || bullet) && line.length === matched.length) {
      // enter on an empty list item ends the list (like GitHub)
      event.currentTarget.setSelectionRange(lineStart, selectionStart);
      document.execCommand("insertText", false, "");
      return;
    }
    const continuation = number
      ? `${Number(number) + 1}${delimiter} `
      : bullet
        ? `${bullet} `
        : "";
    document.execCommand("insertText", false, `\n${indent}${continuation}`);
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    if (mode === "text") {
      if (file.type.startsWith("image/")) {
        insertImageFile(file);
      }
    } else {
      handleFile(file);
    }
  }

  useLayoutEffect(() => {
    if (mode !== "text" || textImageData || !textArea.current) {
      return;
    }
    const textareaElement = textArea.current;
    textareaElement.style.height = "auto";
    const measuredHeight = textareaElement.scrollHeight;
    textareaElement.style.height = `${measuredHeight}px`;
  }, [mode, textInput, textImageData]);

  useEffect(() => {
    if (mode === "text" && !textImageData) {
      textArea.current?.focus();
    }
  }, [mode, textImageData]);

  async function onTextBlur() {
    if (!textInput.trim()) {
      return;
    }
    try {
      const imageData = await renderText(textInput);
      // user may have refocused while rendering; don't yank the editor away
      if (document.activeElement !== textArea.current) {
        setTextImageData(imageData);
      }
    } catch (error) {
      console.error("Rendering failed:", error);
    }
  }

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      for (const item of Array.from(event.clipboardData?.items ?? [])) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            if (mode === "text") {
              event.preventDefault();
              insertImageFile(file);
            } else {
              handleFile(file);
            }
            return;
          }
        }
      }
    }
    addEventListener("paste", onPaste);
    return () => removeEventListener("paste", onPaste);
  }, [mode, textImageData]);

  const previewImageData = mode === "image" ? photoImageData : textImageData;

  useEffect(() => {
    if (!previewImageData || !previewCanvas.current) return;
    const canvas = previewCanvas.current;
    canvas.width = previewImageData.width;
    canvas.height = previewImageData.height;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(previewImageData, 0, 0);
  }, [previewImageData]);

  async function onPrintClick() {
    if (mode === "text") {
      if (!textInput.trim()) {
        alert("Please enter some text first.");
        return;
      }

      try {
        // textImageData may lag behind the blur this click just caused
        const imageData = textImageData ?? (await renderText(textInput));
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


  const modeToggleButtonBase =
    "font-ibm border-[3px] border-black p-3 text-base leading-none";

  return (
    <>
      <img
        src={icon}
        className="h-[156px] w-[156px] drop-shadow-purr"
        alt="PURRINT"
      />

      {!isBluetoothAvailable && (
        <div className="mx-auto my-10 box-border max-w-[384px] border-[3px] border-dashed border-black bg-[#fcc] p-5 text-center">
          PURRINT works only on Android and desktop Chrome-based browsers.
        </div>
      )}

      <div className="flex justify-center gap-3">
        <button
          type="button"
          className={[
            modeToggleButtonBase,
            mode === "image" ? "bg-black text-white" : "bg-white text-black",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setMode("image")}
        >
          Image
        </button>
        <button
          type="button"
          className={[
            modeToggleButtonBase,
            mode === "text" ? "bg-black text-white" : "bg-white text-black",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setMode("text")}
        >
          Text
        </button>
      </div>

      <div className="box-border border-[3px] border-black bg-white p-[5px] drop-shadow-purr">
        <div
          id="preview-container"
          className={[
            "flex w-[384px] min-h-[180px] bg-white box-content",
            mode === "image"
              ? "cursor-pointer items-center justify-center"
              : textImageData
                ? "cursor-text items-start"
                : "cursor-text items-stretch justify-start",
          ].join(" ")}
          onClick={
            mode === "image"
              ? () => imageInput.current?.click()
              : textImageData
                ? () => setTextImageData(undefined)
                : undefined
          }
          onDrop={onDrop}
          onDragOver={(event) => {
            event.preventDefault();
          }}
        >
          {mode === "image" && !photoImageData && (
            <div
              id="preview-text"
              className="w-full pointer-events-none text-center text-black"
            >
              <u>Select image</u>
              <br />
              (or paste or drop here)
            </div>
          )}

          {mode === "text" && (
            <textarea
              ref={textArea}
              className={[
                "pl-[1px] min-h-[180px] w-full resize-none outline-none",
                textImageData ? "hidden" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ lineHeight: LINE_HEIGHT_RATIO }}
              placeholder="Type your message here…"
              value={textInput}
              onChange={(event) => setTextInput(event.target.value)}
              onKeyDown={onTextKeyDown}
              onBlur={onTextBlur}
            />
          )}

          <canvas
            id="preview"
            ref={previewCanvas}
            className={[
              "h-auto w-full pointer-events-none [image-rendering:pixelated]",
              previewImageData ? "block" : "hidden",
            ]
              .filter(Boolean)
              .join(" ")}
          ></canvas>
        </div>
      </div>

      <input
        type="file"
        id="image-input"
        accept="image/*"
        className="hidden"
        ref={imageInput}
        onChange={onImageInputChange}
      />
      <button
        id="print-button"
        type="button"
        className="font-ibm bg-black text-white py-3 pl-5 pr-3 text-base tracking-widest drop-shadow-purr disabled:bg-neutral-700 disabled:text-neutral-300 disabled:cursor-not-allowed disabled:drop-shadow-none disabled:translate-x-0 disabled:translate-y-0 hover:drop-shadow-[2px_2px_rgba(0,0,0,0.4)] hover:translate-x-1 hover:translate-y-1"
        onClick={onPrintClick}
        disabled={!isBluetoothAvailable}
      >
        PURRINT!
      </button>
    </>
  );
}

async function renderText(text: string): Promise<ImageData> {
  // offscreen positioning must live on a wrapper: html-to-image clones the
  // target's computed styles, so left:-9999px on the target itself would
  // push the content out of the snapshot
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "position:fixed;left:-9999px;top:0";
  const container = document.createElement("div");
  container.className = "markdown font-ibm text-retro";
  // padding-left matches the textarea's pl-[1px] so preview aligns with raw text
  container.style.cssText = `width:${WIDTH}px;box-sizing:border-box;padding-left:1px;background:#fff;color:#000;font-size:${FONT_SIZE}px;line-height:${LINE_HEIGHT_RATIO}`;
  container.innerHTML = await marked.parse(text, { breaks: true });
  wrapper.append(container);
  document.body.append(wrapper);
  try {
    // external images must finish loading before layout is measured
    await Promise.all(
      Array.from(container.querySelectorAll("img")).map((img) =>
        img.decode().catch(() => img.remove())
      )
    );
    const rendered = await toCanvas(container, {
      width: WIDTH,
      backgroundColor: "#fff",
      pixelRatio: 1,
    });
    const containerBox = container.getBoundingClientRect();
    const imageBoxes = Array.from(container.querySelectorAll("img")).map(
      (img) => {
        const box = img.getBoundingClientRect();
        return {
          left: box.left - containerBox.left,
          top: box.top - containerBox.top,
          right: box.right - containerBox.left,
          bottom: box.bottom - containerBox.top,
        };
      }
    );
    const imageData = rendered
      .getContext("2d")!
      .getImageData(0, 0, rendered.width, rendered.height);
    // glyph edges can land on half pixels (fractional line positions, off-grid
    // outlines at large sizes) and rasterize gray; dithering would speckle them.
    // Threshold everything except photos, then dither: pure B/W pixels diffuse
    // no error, so text stays crisp while photos get halftoned.
    // O(pixels × images) scan; fine for receipt-sized prints
    const data = imageData.data;
    for (let y = 0; y < imageData.height; y++) {
      for (let x = 0; x < imageData.width; x++) {
        const inImage = imageBoxes.some(
          (b) => x >= b.left && x < b.right && y >= b.top && y < b.bottom
        );
        if (inImage) continue;
        const i = (y * imageData.width + x) * 4;
        const bw = (data[i] + data[i + 1] + data[i + 2]) / 3 < 128 ? 0 : 255;
        data[i] = data[i + 1] = data[i + 2] = bw;
        data[i + 3] = 255;
      }
    }
    dither(imageData);
    return imageData;
  } finally {
    wrapper.remove();
  }
}
