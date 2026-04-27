import type { Page } from "puppeteer-core";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

interface ChromeVideoExtractOptions {
  videoId: string;
  outputDir: string;
  fps: number;
  startTime: number;
  endTime: number;
  jpegQuality?: number;
  batchSize?: number;
}

interface ChromeExtractResult {
  videoId: string;
  outputDir: string;
  totalFrames: number;
  extractionMs: number;
}

export async function extractVideoFramesFromChrome(
  page: Page,
  options: ChromeVideoExtractOptions,
): Promise<ChromeExtractResult> {
  const {
    videoId,
    outputDir,
    fps,
    startTime,
    endTime,
    jpegQuality = 0.95,
    batchSize = 30,
  } = options;

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const totalFrames = Math.ceil((endTime - startTime) * fps);
  const extractStart = Date.now();
  let framesWritten = 0;

  for (let batchStart = 0; batchStart < totalFrames; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, totalFrames);

    const batchFrames: string[] = await page.evaluate(
      async (
        vid: string,
        start: number,
        end: number,
        fpsVal: number,
        tStart: number,
        quality: number,
      ) => {
        const video = document.getElementById(vid) as HTMLVideoElement;
        if (!video) return [];

        const w = video.videoWidth || video.clientWidth;
        const h = video.videoHeight || video.clientHeight;
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d")!;
        const results: string[] = [];

        for (let i = start; i < end; i++) {
          const t = tStart + i / fpsVal;
          video.currentTime = t;
          await new Promise<void>((r) => {
            video.onseeked = () => r();
            setTimeout(r, 200);
          });

          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(video, 0, 0, w, h);

          const blob = await canvas.convertToBlob({
            type: "image/jpeg",
            quality,
          });
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let j = 0; j < bytes.length; j++) {
            binary += String.fromCharCode(bytes[j]!);
          }
          results.push(btoa(binary));
        }

        return results;
      },
      videoId,
      batchStart,
      batchEnd,
      fps,
      startTime,
      jpegQuality,
    );

    for (let i = 0; i < batchFrames.length; i++) {
      const frameIdx = batchStart + i + 1;
      const framePath = `${outputDir}/frame_${String(frameIdx).padStart(5, "0")}.jpg`;
      const data = Buffer.from(batchFrames[i]!, "base64");
      writeFileSync(framePath, data);
      framesWritten++;
    }
  }

  return {
    videoId,
    outputDir,
    totalFrames: framesWritten,
    extractionMs: Date.now() - extractStart,
  };
}
