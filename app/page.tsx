"use client";

import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

type BlendshapeScore = {
  categoryName: string;
  score: number;
};

type Point2D = {
  x: number;
  y: number;
};

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const smoothedScoresRef = useRef<Record<string, number>>({});

  const [cameraOn, setCameraOn] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [error, setError] = useState("");
  const [expression, setExpression] = useState("Waiting for model");
  const [confidence, setConfidence] = useState("0%");
  const [status, setStatus] = useState("Loading model...");
  const [topSignals, setTopSignals] = useState<BlendshapeScore[]>([]);
  const [expressionScores, setExpressionScores] = useState<{ label: string; score: number }[]>([]);

  useEffect(() => {
    const createFaceLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });

        faceLandmarkerRef.current = faceLandmarker;
        setModelLoaded(true);
        setStatus("Model ready");
        setExpression("No face detected");
      } catch (err) {
        console.error(err);
        setError("Failed to load the face model.");
        setStatus("Model error");
      }
    };

    createFaceLandmarker();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      faceLandmarkerRef.current?.close();
    };
  }, []);

  const getScore = (shapes: BlendshapeScore[], name: string) => {
    return shapes.find((s) => s.categoryName === name)?.score ?? 0;
  };

  const mapBlendshapeToExpression = (shapes: BlendshapeScore[]) => {
    if (!shapes.length) {
      return {
        top: { label: "No face detected", score: 0 },
        scores: [],
      };
    }

    const happy =
      getScore(shapes, "mouthSmileLeft") * 1.0 +
      getScore(shapes, "mouthSmileRight") * 1.0 +
      getScore(shapes, "cheekSquintLeft") * 0.4 +
      getScore(shapes, "cheekSquintRight") * 0.4;

    const surprised =
      getScore(shapes, "jawOpen") * 0.35 +
      getScore(shapes, "browInnerUp") * 0.9 +
      getScore(shapes, "eyeWideLeft") * 0.8 +
      getScore(shapes, "eyeWideRight") * 0.8 +
      getScore(shapes, "mouthFunnel") * 0.35 +
      getScore(shapes, "mouthPucker") * 0.2;

    const sad =
      getScore(shapes, "mouthFrownLeft") * 1.15 +
      getScore(shapes, "mouthFrownRight") * 1.15 +
      getScore(shapes, "mouthLowerDownLeft") * 0.55 +
      getScore(shapes, "mouthLowerDownRight") * 0.55 +
      getScore(shapes, "browInnerUp") * 0.55 -
      getScore(shapes, "eyeSquintLeft") * 0.2 -
      getScore(shapes, "eyeSquintRight") * 0.2;

    const angry =
      getScore(shapes, "browDownLeft") * 0.75 +
      getScore(shapes, "browDownRight") * 0.75 +
      getScore(shapes, "eyeSquintLeft") * 0.2 +
      getScore(shapes, "eyeSquintRight") * 0.2 +
      getScore(shapes, "jawOpen") * 0.08 -
      getScore(shapes, "mouthFrownLeft") * 0.25 -
      getScore(shapes, "mouthFrownRight") * 0.25 -
      getScore(shapes, "mouthLowerDownLeft") * 0.15 -
      getScore(shapes, "mouthLowerDownRight") * 0.15;

    const disgust =
      getScore(shapes, "noseSneerLeft") * 1.2 +
      getScore(shapes, "noseSneerRight") * 1.2 +
      getScore(shapes, "mouthUpperUpLeft") * 0.75 +
      getScore(shapes, "mouthUpperUpRight") * 0.75 +
      getScore(shapes, "browDownLeft") * 0.15 +
      getScore(shapes, "browDownRight") * 0.15 -
      getScore(shapes, "mouthSmileLeft") * 0.2 -
      getScore(shapes, "mouthSmileRight") * 0.2;

    const scoresRaw: Record<string, number> = {
      Happy: Math.max(0, happy),
      Surprised: Math.max(0, surprised),
      Sad: Math.max(0, sad),
      Angry: Math.max(0, angry),
      Disgust: Math.max(0, disgust),
    };

    const strongestEmotion = Math.max(...Object.values(scoresRaw));
    const neutral = Math.max(0, 0.85 - strongestEmotion * 0.9);

    const rawScores: Record<string, number> = {
      ...scoresRaw,
      Neutral: neutral,
    };

    const alpha = 0.55;

    for (const key of Object.keys(rawScores)) {
      const previous = smoothedScoresRef.current[key] ?? rawScores[key];
      smoothedScoresRef.current[key] =
        previous * alpha + rawScores[key] * (1 - alpha);
    }

    const scores = Object.entries(smoothedScoresRef.current)
      .map(([label, score]) => ({ label, score }))
      .sort((a, b) => b.score - a.score);

    const top = scores[0];
    const second = scores[1];

    if (!top) {
      return {
        top: { label: "Neutral / Unclear", score: 0 },
        scores,
      };
    }

    if (top.label !== "Neutral" && top.score < 0.22) {
      return {
        top: { label: "Neutral / Unclear", score: top.score },
        scores,
      };
    }

    if (second && top.label !== "Neutral" && top.score - second.score < 0.03) {
      return {
        top: { label: "Neutral / Unclear", score: top.score },
        scores,
      };
    }

    return { top, scores };
  };

  const drawOverlay = (landmarks: Point2D[] = []) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);

    if (!landmarks.length) return;

    ctx.fillStyle = "rgba(0, 255, 170, 0.92)";

    for (const point of landmarks) {
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const predictLoop = () => {
    const video = videoRef.current;
    const faceLandmarker = faceLandmarkerRef.current;

    if (!video || !faceLandmarker || video.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(predictLoop);
      return;
    }

    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;

      const results = faceLandmarker.detectForVideo(video, performance.now());

      const shapes = results.faceBlendshapes?.[0]?.categories ?? [];
      const simplifiedShapes = shapes.map((shape) => ({
        categoryName: shape.categoryName,
        score: shape.score,
      }));

      const topThree = [...simplifiedShapes]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      setTopSignals(topThree);

      const inferred = mapBlendshapeToExpression(simplifiedShapes);
      setExpression(inferred.top.label);
      setConfidence(`${Math.round(inferred.top.score * 100)}%`);
      setExpressionScores(inferred.scores.slice(0, 5));
      setStatus(results.faceLandmarks?.length ? "Face detected" : "Scanning...");

      const landmarks = results.faceLandmarks?.[0] ?? [];
      drawOverlay(landmarks);
    }

    animationFrameRef.current = requestAnimationFrame(predictLoop);
  };

  const startCamera = async () => {
    setError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraOn(true);
      setStatus(modelLoaded ? "Camera active" : "Camera active, model loading");

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      predictLoop();
    } catch (err) {
      console.error(err);
      setError("Camera access was denied or no camera was found.");
      setStatus("Camera error");
    }
  };

  const stopCamera = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    smoothedScoresRef.current = {};
    setCameraOn(false);
    setExpression(modelLoaded ? "No face detected" : "Waiting for model");
    setConfidence("0%");
    setTopSignals([]);
    setExpressionScores([]);
    setStatus(modelLoaded ? "Idle" : "Loading model...");
  };

  const statusColor =
    status === "Face detected"
      ? "text-emerald-400"
      : status.includes("error")
      ? "text-red-400"
      : "text-cyan-300";

  return (
    <main className="min-h-screen overflow-hidden bg-[#030712] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,255,170,0.08),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.08),transparent_25%)]" />
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:36px_36px]" />

      <section className="relative z-10 mx-auto max-w-7xl px-6 py-8">
        <header className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.35em] text-emerald-400/80">
              Experimental Emotion Interface
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
              PsychBot
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-zinc-400 sm:text-base">
              Real-time facial expression analysis with local webcam processing,
              live blendshape signals, and face landmark tracking.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TopChip label="Model" value={modelLoaded ? "ONLINE" : "BOOTING"} />
            <TopChip label="Camera" value={cameraOn ? "LIVE" : "OFF"} />
            <TopChip label="Faces" value={cameraOn ? "01" : "00"} />
            <TopChip label="Mode" value="LOCAL" />
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[1.7fr_0.9fr]">
          <div className="rounded-[28px] border border-emerald-500/20 bg-black/40 p-4 shadow-[0_0_40px_rgba(16,185,129,0.08)] backdrop-blur-md">
            <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                  Vision Feed
                </p>
                <p className="mt-1 text-sm text-zinc-300">
                  Face mesh overlay and live capture stream
                </p>
              </div>
              <div className={`text-sm font-medium ${statusColor}`}>{status}</div>
            </div>

            <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[#02040a]">
              <div className="absolute left-4 top-4 z-20 rounded-full border border-emerald-400/30 bg-black/60 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-300 backdrop-blur">
                {cameraOn ? "Camera Active" : "Camera Standby"}
              </div>

              <div className="absolute right-4 top-4 z-20 rounded-full border border-cyan-400/30 bg-black/60 px-3 py-1 text-xs uppercase tracking-[0.2em] text-cyan-300 backdrop-blur">
                {confidence}
              </div>

              <div className="relative aspect-video w-full bg-black">
                {cameraOn ? (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="h-full w-full object-cover opacity-85"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(0,0,0,0.35)_100%)]" />
                    <canvas
                      ref={canvasRef}
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    />
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <p className="text-xl font-medium text-white">Feed Offline</p>
                      <p className="mt-2 text-sm text-zinc-500">
                        Initialize the camera to begin live analysis
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <MetricCard label="Expression" value={expression} />
              <MetricCard label="Confidence" value={confidence} />
              <MetricCard label="Status" value={status} valueClassName={statusColor} />
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-[28px] border border-cyan-500/20 bg-black/40 p-5 shadow-[0_0_40px_rgba(34,211,238,0.06)] backdrop-blur-md">
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">
                Control Panel
              </p>

              <div className="mt-5 grid gap-3">
                <button
                  onClick={startCamera}
                  className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-5 py-3 text-left transition hover:border-emerald-300/50 hover:bg-emerald-400/15"
                >
                  <span className="block text-sm font-semibold text-emerald-300">
                    Start Camera
                  </span>
                  <span className="mt-1 block text-xs text-zinc-400">
                    Activate feed and begin face tracking
                  </span>
                </button>

                <button
                  onClick={stopCamera}
                  className="rounded-2xl border border-red-400/20 bg-red-500/5 px-5 py-3 text-left transition hover:border-red-300/40 hover:bg-red-400/10"
                >
                  <span className="block text-sm font-semibold text-red-300">
                    Stop Camera
                  </span>
                  <span className="mt-1 block text-xs text-zinc-400">
                    Shutdown stream and clear active overlay
                  </span>
                </button>
              </div>

              {error && (
                <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-300">
                  {error}
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-white/10 bg-black/40 p-5 backdrop-blur-md">
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                Expression Scores
              </p>

              <div className="mt-5 space-y-4">
                {expressionScores.length > 0 ? (
                  expressionScores.map((item) => (
                    <div key={item.label}>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="max-w-[75%] truncate text-zinc-300">
                          {item.label}
                        </span>
                        <span className="text-cyan-300">
                          {Math.round(item.score * 100)}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-400"
                          style={{ width: `${Math.max(0, Math.min(100, item.score * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-zinc-500">
                    Waiting for expression scores.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-black/40 p-5 backdrop-blur-md">
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                Signal Breakdown
              </p>

              <div className="mt-5 space-y-4">
                {topSignals.length > 0 ? (
                  topSignals.map((item) => (
                    <div key={item.categoryName}>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="max-w-[75%] truncate text-zinc-300">
                          {item.categoryName}
                        </span>
                        <span className="text-emerald-300">
                          {Math.round(item.score * 100)}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400"
                          style={{ width: `${item.score * 100}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-zinc-500">
                    Awaiting signal input from live capture.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-black/40 p-5 backdrop-blur-md">
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                Session Notes
              </p>
              <div className="mt-4 space-y-3 text-sm text-zinc-400">
                <p>• Processing is local to the browser session.</p>
                <p>• Face label is an expression estimate, not mind-reading.</p>
                <p>• Best results come from front-facing light and one visible face.</p>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function TopChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
      <p className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  valueClassName = "text-white",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">{label}</p>
      <p className={`mt-2 text-lg font-semibold ${valueClassName}`}>{value}</p>
    </div>
  );
}
