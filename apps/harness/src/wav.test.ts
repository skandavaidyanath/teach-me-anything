import { describe, expect, it } from "vitest";
import { pcmDurationMs, pcmToWav } from "./wav";

describe("wav", () => {
  it("writes a valid 44-byte header around the samples", () => {
    const pcm = Buffer.alloc(48000); // one second of 24kHz mono s16le
    const wav = pcmToWav(pcm, 24000);
    expect(wav.length).toBe(44 + 48000);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(48000);
  });

  it("computes duration from byte length", () => {
    expect(pcmDurationMs(48000, 24000)).toBe(1000);
    expect(pcmDurationMs(12000, 24000)).toBe(250);
  });
});
