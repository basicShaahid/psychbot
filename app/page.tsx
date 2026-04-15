"use client";

import { useEffect, useRef, useState } from "react";

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);

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
      }

      setCameraOn(true);
    } catch (err) {
      setError("Camera access was denied or no camera was found.");
      console.error(err);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraOn(false);
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return (
    <main className="min-h-screen bg-black text-white px-6 py-10">
      <section className="mx-auto flex max-w-5xl flex-col items-center gap-8">
        <div className="text-center space-y-3">
          <h1 className="text-5xl font-bold tracking-tight">PsychBot</h1>
          <p className="text-zinc-400 text-lg">
            Real-time facial expression tracking from your webcam
          </p>
        </div>

        <div className="w-full max-w-3xl overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="aspect-video w-full bg-zinc-900 flex items-center justify-center">
            {cameraOn ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="text-center">
                <p className="text-xl font-medium">Camera preview</p>
                <p className="mt-2 text-sm text-zinc-500">
                  Start the camera to begin
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-4">
          <button
            onClick={startCamera}
            className="rounded-2xl border border-zinc-700 px-6 py-3 hover:bg-zinc-900 transition"
          >
            Start Camera
          </button>

          <button
            onClick={stopCamera}
            className="rounded-2xl border border-zinc-700 px-6 py-3 hover:bg-zinc-900 transition"
          >
            Stop Camera
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}
      </section>
    </main>
  );
}