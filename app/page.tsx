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

  const [cameraOn, setCameraOn] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [error, setError] = useState("");
  const [expression, setExpression] = useState("Waiting for model");
  const [confidence, setConfidence] = useState("0%");
  const [status, setStatus] = useState("Loading model...");
  const [topSignals, setTopSignals] = useState<BlendshapeScore[]>([]);

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

  const mapBlendshapeToExpression = (shapes: BlendshapeScore[]) => {
    if (!shapes.length) {
      return { label: "No face detected", score: 0 };
    }

    const sorted = [...shapes].sort((a, b) => b.score - a.score);
    const top = sorted[0];

    const map: Record<string, string> = {
      mouthSmileLeft: "Happy",
      mouthSmileRight: "Happy",
      browInnerUp: "Surprised",
      eyeWideLeft: "Surprised",
      eyeWideRight: "Surprised",
      jawOpen: "Surprised",
      mouthFrownLeft: "Sad",
      mouthFrownRight: "Sad",
      browDownLeft: "Angry",
      browDownRight: "Angry",
      noseSneerLeft: "Disgust",
      noseSneerRight: "Disgust",
    };

    return {
      label: map[top.categoryName] ?? "Neutral / Unclear",
      score: top.score,
    };
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

    ctx.fillStyle = "rgba(255,255,255,0.85)";

    for (const point of landmarks) {
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, 1.5, 0, Math.PI * 2);
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
      setExpression(inferred.label);
      setConfidence(`${Math.round(inferred.score * 100)}%`);
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

    setCameraOn(false);
    setExpression(modelLoaded ? "No face detected" : "Waiting for model");
    setConfidence("0%");
    setTopSignals([]);
    setStatus(modelLoaded ? "Idle" : "Loading model...");
  };

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <section className="mx-auto max-w-6xl">
        <div className="mb-8 space-y-3 text-center">
          <h1 className="text-5xl font-bold tracking-tight">PsychBot</h1>
          <p className="text-lg text-zinc-400">
            Real-time facial expression tracking from your webcam
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="relative aspect-video w-full bg-zinc-900">
              {cameraOn ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                  />
                  <canvas
                    ref={canvasRef}
                    className="pointer-events-none absolute inset-0 h-full w-full"
                  />
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-center">
                  <div>
                    <p className="text-xl font-medium">Camera preview</p>
                    <p className="mt-2 text-sm text-zinc-500">
                      Start the camera to begin
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <aside className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="mb-6 text-xl font-semibold">Live Analysis</h2>

            <div className="space-y-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-sm text-zinc-400">Current Expression</p>
                <p className="mt-2 text-2xl font-semibold">{expression}</p>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-sm text-zinc-400">Confidence</p>
                <p className="mt-2 text-2xl font-semibold">{confidence}</p>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-sm text-zinc-400">System Status</p>
                <p className="mt-2 text-2xl font-semibold">{status}</p>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="mb-3 text-sm text-zinc-400">Top Face Signals</p>
                {topSignals.length > 0 ? (
                  <div className="space-y-3">
                    {topSignals.map((item) => (
                      <div key={item.categoryName}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="truncate pr-3">{item.categoryName}</span>
                          <span>{Math.round(item.score * 100)}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-zinc-800">
                          <div
                            className="h-2 rounded-full bg-white"
                            style={{ width: `${item.score * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">No signals yet</p>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={startCamera}
                className="rounded-2xl border border-zinc-700 px-5 py-3 transition hover:bg-zinc-900"
              >
                Start Camera
              </button>

              <button
                onClick={stopCamera}
                className="rounded-2xl border border-zinc-700 px-5 py-3 transition hover:bg-zinc-900"
              >
                Stop Camera
              </button>
            </div>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          </aside>
        </div>
      </section>
    </main>
  );
}