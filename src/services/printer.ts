const PRINTER_WIDTH = 384;

const Command = {
  RETRACT_PAPER: new Uint8Array([0xa0]),
  FEED_PAPER: new Uint8Array([0xa1]),
  DRAW_BITMAP: new Uint8Array([0xa2]),
  GET_DEV_STATE: new Uint8Array([0xa3]),
  CONTROL_LATTICE: new Uint8Array([0xa6]),
  GET_DEV_INFO: new Uint8Array([0xa8]),
  OTHER_FEED_PAPER: new Uint8Array([0xbd]),
  DRAWING_MODE: new Uint8Array([0xbe]),
  SET_ENERGY: new Uint8Array([0xaf]),
  SET_QUALITY: new Uint8Array([0xa4]),
};

const Lattice = {
  PRINT: new Uint8Array([
    0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c,
  ]),
  FINISH: new Uint8Array([
    0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17,
  ]),
};

const PrintSpeed = {
  IMAGE: new Uint8Array([0x23]),
  BLANK: new Uint8Array([0x19]),
};

let device: BluetoothDevice | null = null;

const crc8_table = [
  0x00, 0x07, 0x0e, 0x09, 0x1c, 0x1b, 0x12, 0x15, 0x38, 0x3f, 0x36, 0x31, 0x24,
  0x23, 0x2a, 0x2d, 0x70, 0x77, 0x7e, 0x79, 0x6c, 0x6b, 0x62, 0x65, 0x48, 0x4f,
  0x46, 0x41, 0x54, 0x53, 0x5a, 0x5d, 0xe0, 0xe7, 0xee, 0xe9, 0xfc, 0xfb, 0xf2,
  0xf5, 0xd8, 0xdf, 0xd6, 0xd1, 0xc4, 0xc3, 0xca, 0xcd, 0x90, 0x97, 0x9e, 0x99,
  0x8c, 0x8b, 0x82, 0x85, 0xa8, 0xaf, 0xa6, 0xa1, 0xb4, 0xb3, 0xba, 0xbd, 0xc7,
  0xc0, 0xc9, 0xce, 0xdb, 0xdc, 0xd5, 0xd2, 0xff, 0xf8, 0xf1, 0xf6, 0xe3, 0xe4,
  0xed, 0xea, 0xb7, 0xb0, 0xb9, 0xbe, 0xab, 0xac, 0xa5, 0xa2, 0x8f, 0x88, 0x81,
  0x86, 0x93, 0x94, 0x9d, 0x9a, 0x27, 0x20, 0x29, 0x2e, 0x3b, 0x3c, 0x35, 0x32,
  0x1f, 0x18, 0x11, 0x16, 0x03, 0x04, 0x0d, 0x0a, 0x57, 0x50, 0x59, 0x5e, 0x4b,
  0x4c, 0x45, 0x42, 0x6f, 0x68, 0x61, 0x66, 0x73, 0x74, 0x7d, 0x7a, 0x89, 0x8e,
  0x87, 0x80, 0x95, 0x92, 0x9b, 0x9c, 0xb1, 0xb6, 0xbf, 0xb8, 0xad, 0xaa, 0xa3,
  0xa4, 0xf9, 0xfe, 0xf7, 0xf0, 0xe5, 0xe2, 0xeb, 0xec, 0xc1, 0xc6, 0xcf, 0xc8,
  0xdd, 0xda, 0xd3, 0xd4, 0x69, 0x6e, 0x67, 0x60, 0x75, 0x72, 0x7b, 0x7c, 0x51,
  0x56, 0x5f, 0x58, 0x4d, 0x4a, 0x43, 0x44, 0x19, 0x1e, 0x17, 0x10, 0x05, 0x02,
  0x0b, 0x0c, 0x21, 0x26, 0x2f, 0x28, 0x3d, 0x3a, 0x33, 0x34, 0x4e, 0x49, 0x40,
  0x47, 0x52, 0x55, 0x5c, 0x5b, 0x76, 0x71, 0x78, 0x7f, 0x6a, 0x6d, 0x64, 0x63,
  0x3e, 0x39, 0x30, 0x37, 0x22, 0x25, 0x2c, 0x2b, 0x06, 0x01, 0x08, 0x0f, 0x1a,
  0x1d, 0x14, 0x13, 0xae, 0xa9, 0xa0, 0xa7, 0xb2, 0xb5, 0xbc, 0xbb, 0x96, 0x91,
  0x98, 0x9f, 0x8a, 0x8d, 0x84, 0x83, 0xde, 0xd9, 0xd0, 0xd7, 0xc2, 0xc5, 0xcc,
  0xcb, 0xe6, 0xe1, 0xe8, 0xef, 0xfa, 0xfd, 0xf4, 0xf3,
];

function crc8(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc = crc8_table[(crc ^ byte) & 0xff];
  }
  return crc & 0xff;
}

// framing: 0x51 0x78, command, 0x00, length, 0x00, <data>, crc, 0x00
const FRAME_OVERHEAD = 8;
const LINE_BYTES = PRINTER_WIDTH / 8;
// one DRAW_BITMAP frame per scanline
const ROW_FRAME = FRAME_OVERHEAD + LINE_BYTES;
const CHUNK_SIZE = 64;

function uint16(value: number): Uint8Array {
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setUint16(0, value, true);
  return new Uint8Array(buffer);
}

/* Writes one framed command into `target` at `offset` and returns the offset
   just past it. Writing in place rather than returning a fresh array is what
   keeps assembling a long print linear: concatenating a frame at a time copied
   the whole command stream once per scanline, so a page of text — thousands of
   scanlines — locked the tab up for tens of seconds before the first byte went
   out. */
function writeCommand(
  target: Uint8Array,
  offset: number,
  command: Uint8Array,
  data: Uint8Array
): number {
  target[offset] = 0x51;
  target[offset + 1] = 0x78;
  target[offset + 2] = command[0];
  target[offset + 3] = 0x00;
  target[offset + 4] = data.length;
  target[offset + 5] = 0x00;
  target.set(data, offset + 6);
  target[offset + 6 + data.length] = crc8(data);
  target[offset + 7 + data.length] = 0x00;
  return offset + FRAME_OVERHEAD + data.length;
}

/* Packs scanline `y` into `line`: 1 bit per pixel, 1 = black. The printer's
   coordinate system runs the other way, so the row is read right-to-left and
   the bytes are laid down back-to-front — flipping as we pack, instead of
   copying the whole bitmap to flip it first. */
function packRow(imageData: ImageData, y: number, line: Uint8Array) {
  const { width, data } = imageData;
  line.fill(0);
  const columns = Math.min(width, PRINTER_WIDTH);
  for (let x = 0; x < columns; x++) {
    const index = (y * width + (width - 1 - x)) * 4;
    if (data[index] === 0) {
      line[LINE_BYTES - 1 - (x >> 3)] |= 1 << (7 - (x & 7));
    }
  }
}

function buildCommands(imageData: ImageData): Uint8Array {
  const setup: [Uint8Array, Uint8Array][] = [
    [Command.SET_QUALITY, new Uint8Array([0x33])],
    [Command.CONTROL_LATTICE, Lattice.PRINT],
    [Command.SET_ENERGY, uint16(17500)],
    [Command.DRAWING_MODE, new Uint8Array([0x00])],
    [Command.OTHER_FEED_PAPER, PrintSpeed.IMAGE],
  ];
  const teardown: [Uint8Array, Uint8Array][] = [
    [Command.CONTROL_LATTICE, Lattice.FINISH],
    [Command.FEED_PAPER, uint16(50)],
  ];

  const framed = (frames: [Uint8Array, Uint8Array][]) =>
    frames.reduce((total, [, data]) => total + FRAME_OVERHEAD + data.length, 0);
  const commands = new Uint8Array(
    framed(setup) + imageData.height * ROW_FRAME + framed(teardown)
  );

  let offset = 0;
  for (const [command, data] of setup) {
    offset = writeCommand(commands, offset, command, data);
  }
  const line = new Uint8Array(LINE_BYTES);
  for (let y = 0; y < imageData.height; y++) {
    packRow(imageData, y, line);
    offset = writeCommand(commands, offset, Command.DRAW_BITMAP, line);
  }
  for (const [command, data] of teardown) {
    offset = writeCommand(commands, offset, command, data);
  }
  return commands;
}

export async function printImage(imageData: ImageData) {
  if (!device) {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "MX" }],
      optionalServices: ["0000ae30-0000-1000-8000-00805f9b34fb"],
    });
  }

  if (!device.gatt?.connected) {
    await device.gatt?.connect();
  }

  const server = device.gatt!;
  const service = await server.getPrimaryService(
    "0000ae30-0000-1000-8000-00805f9b34fb"
  );
  const characteristic = await service.getCharacteristic(
    "0000ae01-0000-1000-8000-00805f9b34fb"
  );

  const commands = buildCommands(imageData);

  for (let i = 0; i < commands.length; i += CHUNK_SIZE) {
    await characteristic.writeValue(commands.slice(i, i + CHUNK_SIZE));
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
