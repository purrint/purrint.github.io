import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { marked } from "marked";
import { toCanvas } from "html-to-image";
import { dither, loadImage, renderImage } from "../services/render.ts";
import { printImage } from "../services/printer.ts";
import icon from "../assets/icon.svg";

const WIDTH = 384;
// ~1 m of paper at 8 dots/mm. `large` scales type up until the lines fill the
// paper's width, so a two-word message would otherwise print until the roll runs
// out — and blow past the browser's canvas dimension limit on the way
const MAX_BANNER_LENGTH = 8192;

type Mode = "image" | "text";
type TextSize = "small" | "medium" | "large";
type ImageOrientation = "vertical" | "horizontal";

type TextStyle = {
  /* Markdown stylesheet variant, see index.css */
  markdown: string;
  /* face + rasterization, shared by the editor and the rendered bitmap */
  font: string;
  fontSize: number;
  lineHeight: number;
  banner: boolean;
};

const TEXT_STYLES: Record<TextSize, TextStyle> = {
  small: {
    markdown: "markdown-bitmap",
    font: "font-ibm text-retro",
    fontSize: 16,
    // 18px line boxes: fractional ones (16 × 1.15 = 18.4) put every other
    // baseline on a half pixel, which the bitmap font renders as alternately
    // fat and thin rows
    lineHeight: 1.125,
    banner: false,
  },
  medium: {
    markdown: "markdown-proportional",
    font: "font-roboto text-print",
    // 2× the bitmap mode, ~24 characters to a line: large enough to read at
    // arm's length off a 48mm roll without shredding prose into two-word lines
    fontSize: 32,
    lineHeight: 1.25,
    banner: false,
  },
  large: {
    markdown: "markdown-proportional markdown-banner",
    font: "font-roboto text-print",
    // a starting point only — fitBanner() rescales this until the lines fill
    // the paper. It is still what the editor types at.
    fontSize: 24,
    // don't tighten this: a line box is what fills the paper, so the outer half
    // of the leading is the only thing keeping the first line's tallest ink
    // (Ú, Ř — 0.93em in Roboto against a 1.25em box) inside the paper's edge
    lineHeight: 1.25,
    banner: true,
  },
};
const TEXT_SIZES = ["small", "medium", "large"] as const;
const IMAGE_ORIENTATIONS = ["vertical", "horizontal"] as const;

export default function PurrintApp() {
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);

  const [photoImage, setPhotoImage] = useState<HTMLImageElement>();
  const [photoImageData, setPhotoImageData] = useState<ImageData>();
  const [imageOrientation, setImageOrientation] =
    useState<ImageOrientation>("vertical");
  const [textImageData, setTextImageData] = useState<ImageData>();
  const [isBluetoothAvailable] = useState("bluetooth" in navigator);
  const [mode, setMode] = useState<Mode>("image");
  const [textSize, setTextSize] = useState<TextSize>("small");
  const [isMarkdown, setIsMarkdown] = useState(true);
  const [textInput, setTextInput] = useState("");

  const textStyle = TEXT_STYLES[textSize];

  async function handleFile(file: File) {
    try {
      const image = await loadImage(file);
      // a landscape shot is the one worth turning sideways: upright it gets
      // squeezed into 384px, sideways it gets the whole length of the roll
      setImageOrientation(
        image.width > image.height ? "horizontal" : "vertical"
      );
      setPhotoImage(image);
    } catch (error) {
      console.error("Rendering failed:", error);
      alert("Rendering failed. See console for details.");
    }
  }

  useEffect(() => {
    if (!photoImage || !previewCanvas.current) {
      return;
    }
    try {
      setPhotoImageData(
        renderImage(photoImage, previewCanvas.current, {
          rotate: imageOrientation === "horizontal",
        })
      );
    } catch (error) {
      console.error("Rendering failed:", error);
      alert("Rendering failed. See console for details.");
    }
  }, [photoImage, imageOrientation]);

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
      renderImage(await loadImage(file), canvas, { width: WIDTH - 1 });
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
    // textSize: switching it changes the editor's own type size, so the text
    // needs re-measuring even though it hasn't changed
  }, [mode, textInput, textImageData, textSize]);

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
      const imageData = await renderText(textInput, textSize, isMarkdown);
      // user may have refocused while rendering; don't yank the editor away
      if (document.activeElement !== textArea.current) {
        setTextImageData(imageData);
      }
    } catch (error) {
      console.error("Rendering failed:", error);
    }
  }

  useEffect(() => {
    // the preview is a snapshot, so a style switch has to redraw it. Keyed on
    // the styles alone: textImageData is what the effect writes, and depending
    // on it would loop
    if (!textImageData) {
      return;
    }
    let current = true;
    renderText(textInput, textSize, isMarkdown)
      .then((imageData) => {
        if (current) {
          setTextImageData(imageData);
        }
      })
      .catch((error) => {
        console.error("Rendering failed:", error);
      });
    return () => {
      current = false;
    };
  }, [textSize, isMarkdown]);

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
        const imageData =
          textImageData ?? (await renderText(textInput, textSize, isMarkdown));
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
  const subModeButtonBase =
    "font-ibm border-[3px] border-black px-3 py-2 text-sm capitalize leading-none";
  const toggleColors = (selected: boolean) =>
    selected ? "bg-black text-white" : "bg-white text-black";
  // both modes carry a row of sub-mode buttons; only the options differ
  const subModes: { label: string; selected: boolean; select: () => void }[] =
    mode === "text"
      ? [
          ...TEXT_SIZES.map((size) => ({
            label: size,
            selected: textSize === size,
            select: () => setTextSize(size),
          })),
          {
            label: "markdown",
            selected: isMarkdown,
            select: () => setIsMarkdown((value) => !value),
          },
        ]
      : IMAGE_ORIENTATIONS.map((orientation) => ({
          label: orientation,
          selected: imageOrientation === orientation,
          select: () => setImageOrientation(orientation),
        }));

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
          className={[modeToggleButtonBase, toggleColors(mode === "image")].join(
            " "
          )}
          onClick={() => setMode("image")}
        >
          Image
        </button>
        <button
          type="button"
          className={[modeToggleButtonBase, toggleColors(mode === "text")].join(
            " "
          )}
          onClick={() => setMode("text")}
        >
          Text
        </button>
      </div>

      <div className="flex justify-center gap-2">
        {subModes.map(({ label, selected, select }) => (
          <button
            key={label}
            type="button"
            className={[subModeButtonBase, toggleColors(selected)].join(" ")}
            onClick={select}
          >
            {label}
          </button>
        ))}
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
                textStyle.font,
                textImageData ? "hidden" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                fontSize: textStyle.fontSize,
                lineHeight: textStyle.lineHeight,
              }}
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

// html-to-image rewrites every copied font-size to `floor(size) - 0.1` as a
// guard against text clipping in its SVG snapshot. That renders 16px text at
// 15.9px, so the 9px glyph advance becomes 8.94px: identical letters creep off
// the pixel grid and the threshold below turns their stems 1px or 2px wide,
// banding the preview into light and dark stripes. We embed the exact font, so
// nothing can reflow — copy every property except font-size and inline the real
// sizes ourselves.
function styleProperties(): string[] {
  return Array.from(getComputedStyle(document.documentElement)).filter(
    (property) => property !== "font-size"
  );
}

function inlineFontSizes(root: HTMLElement) {
  const elements = [root, ...root.querySelectorAll<HTMLElement>("*")];
  // measure first: writing a size back changes what em-based children compute to
  const sizes = elements.map((element) => getComputedStyle(element).fontSize);
  elements.forEach((element, index) => {
    element.style.fontSize = sizes[index];
  });
}

// `large` sizes the type so that the text's lines exactly span the paper's
// width: one line means a line box 384px thick, two means 192px each. Every
// length in the Markdown styles is em-based, so the stacked height of the lines
// scales with the font size and each pass is one step of a division — what keeps
// it from being a single one is the handful of lengths that don't scale (1px
// borders) plus layout rounding.
function fitBanner(container: HTMLElement) {
  let fontSize = parseFloat(container.style.fontSize);
  for (let pass = 0; pass < 4; pass++) {
    const { width, height } = container.getBoundingClientRect();
    if (width < 1) {
      return;
    }
    const scale = Math.min(WIDTH / width, MAX_BANNER_LENGTH / height);
    if (Math.abs(scale - 1) < 0.001) {
      break;
    }
    fontSize *= scale;
    container.style.fontSize = `${fontSize}px`;
  }
  // never spill past the paper edge, even if the passes ran out mid-correction
  const overshoot = container.getBoundingClientRect().width / WIDTH;
  if (overshoot > 1) {
    container.style.fontSize = `${fontSize / overshoot}px`;
  }
}

async function renderText(
  text: string,
  size: TextSize,
  markdown: boolean
): Promise<ImageData> {
  const style = TEXT_STYLES[size];
  // offscreen positioning must live on a wrapper: html-to-image clones the
  // target's computed styles, so left:-9999px on the target itself would
  // push the content out of the snapshot
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "position:fixed;left:-9999px;top:0";
  const container = document.createElement("div");
  container.className = `markdown ${style.markdown} ${style.font}`;
  container.style.cssText = [
    "box-sizing:border-box",
    "background:#fff",
    "color:#000",
    `font-size:${style.fontSize}px`,
    `line-height:${style.lineHeight}`,
    style.banner
      ? // vertical-rl turns the paper sideways: lines stack across its width and
        // run down its length. rl, not lr: the glyphs rotate clockwise, so the
        // roll is read by turning it counter-clockwise, which brings its right
        // edge up top — that has to be where the first line sits.
        // A max-content inline size stops lines wrapping, so the line count is
        // whatever the text says and fitBanner() can size to it
        "writing-mode:vertical-rl;inline-size:max-content"
      : // padding-left matches the textarea's pl-[1px] so preview aligns with raw text
        `inline-size:${WIDTH}px;padding-left:1px`,
  ].join(";");
  if (markdown) {
    container.innerHTML = await marked.parse(text, { breaks: true });
  } else {
    // pre-wrap, not <pre>: the .markdown styles' box (border, padding) is for
    // code, and lines still have to wrap at the paper's width
    container.style.whiteSpace = "pre-wrap";
    container.textContent = text;
  }
  wrapper.append(container);
  document.body.append(wrapper);
  try {
    // external images must finish loading before layout is measured
    await Promise.all(
      Array.from(container.querySelectorAll("img")).map((img) =>
        img.decode().catch(() => img.remove())
      )
    );
    // …and so must the webfonts, or a first render in a proportional mode gets
    // measured — and, for the banner, sized — with fallback metrics. Reading
    // layout is what makes the browser request them, so do that first and
    // fonts.ready then has something to wait for.
    container.getBoundingClientRect();
    await document.fonts.ready;
    if (style.banner) {
      fitBanner(container);
    }
    inlineFontSizes(container);
    const rendered = await toCanvas(container, {
      width: WIDTH,
      backgroundColor: "#fff",
      pixelRatio: 1,
      includeStyleProperties: styleProperties(),
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
