/**
 * Worker message protocol types.
 *
 * Main thread → Worker: WorkerInMessage
 * Worker → Main thread: WorkerOutMessage
 */

export type WorkerInMessage =
  | {
      type: "init";
      config: {
        width: number;
        height: number;
        fps: number;
        codec: string;
        bitrate: number;
        format: "mp4" | "webm";
      };
    }
  | {
      type: "frame";
      bitmap: ImageBitmap;
      index: number;
      timestamp: number;
    }
  | {
      type: "set-audio";
      channelData: Float32Array[];
      sampleRate: number;
    }
  | {
      type: "finalize";
    };

export type WorkerOutMessage =
  | { type: "ready" }
  | { type: "frame-encoded"; index: number }
  | { type: "done"; blob: Blob }
  | { type: "error"; message: string }
  | { type: "progress"; framesEncoded: number };
