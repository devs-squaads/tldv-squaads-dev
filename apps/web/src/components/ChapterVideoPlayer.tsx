"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import {
  Play, Pause, Volume2, VolumeX, Maximize,
  SkipBack, SkipForward,
} from "lucide-react";

export interface Chapter {
  timeSeconds: number;
  title: string;
  description: string;
}

interface ChapterVideoPlayerProps {
  src: string;
  chapters: Chapter[];
  durationSeconds?: number;
  onChapterChange?: (chapter: Chapter, index: number) => void;
  /** Callback that receives the seekTo function so parent can trigger seeks */
  onSeekReady?: (seekFn: (time: number) => void) => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ChapterVideoPlayer({
  src,
  chapters,
  durationSeconds,
  onChapterChange,
  onSeekReady,
}: ChapterVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds || 0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [hoveredChapter, setHoveredChapter] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [activeChapter, setActiveChapter] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout>>(null);

  // Sort chapters by time
  const sortedChapters = [...chapters].sort((a, b) => a.timeSeconds - b.timeSeconds);

  // Find active chapter based on current time
  const findActiveChapter = useCallback(
    (time: number) => {
      for (let i = sortedChapters.length - 1; i >= 0; i--) {
        if (time >= sortedChapters[i].timeSeconds) return i;
      }
      return 0;
    },
    [sortedChapters]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      const newActive = findActiveChapter(video.currentTime);
      if (newActive !== activeChapter) {
        setActiveChapter(newActive);
        if (onChapterChange && sortedChapters[newActive]) {
          onChapterChange(sortedChapters[newActive], newActive);
        }
      }
    };

    const onLoadedMetadata = () => {
      setDuration(video.duration);
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
    };
  }, [activeChapter, findActiveChapter, onChapterChange, sortedChapters]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (videoRef.current) {
      videoRef.current.volume = v;
      videoRef.current.muted = v === 0;
      setIsMuted(v === 0);
    }
  };

  const seekTo = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  // Expose seekTo to parent
  useEffect(() => {
    if (onSeekReady) onSeekReady(seekTo);
  }, [onSeekReady, seekTo]);

  const skipChapter = (direction: 1 | -1) => {
    const newIdx = Math.max(0, Math.min(sortedChapters.length - 1, activeChapter + direction));
    seekTo(sortedChapters[newIdx].timeSeconds);
  };

  const toggleFullscreen = () => {
    const container = videoRef.current?.parentElement?.parentElement;
    if (!container) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else container.requestFullscreen();
  };

  // Auto-hide controls
  const resetControlsTimer = () => {
    setShowControls(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  };

  // Calculate chapter segments for progress bar
  const getChapterSegments = () => {
    if (duration <= 0 || sortedChapters.length === 0) {
      return [{ start: 0, end: 100, chapter: null, index: -1 }];
    }

    return sortedChapters.map((ch, i) => {
      const start = (ch.timeSeconds / duration) * 100;
      const nextTime = i < sortedChapters.length - 1 ? sortedChapters[i + 1].timeSeconds : duration;
      const end = (nextTime / duration) * 100;
      return { start, end, chapter: ch, index: i };
    });
  };

  const segments = getChapterSegments();
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return;
    const x = (e.clientX - rect.left) / rect.width;
    seekTo(x * duration);
  };

  const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return;
    const x = (e.clientX - rect.left) / rect.width;
    const time = x * duration;
    setHoverTime(time);
    setHoverX(e.clientX - rect.left);

    // Find which chapter is hovered
    const chIdx = findActiveChapter(time);
    setHoveredChapter(chIdx);
  };

  const handleProgressLeave = () => {
    setHoverTime(null);
    setHoveredChapter(null);
  };

  return (
    <div
      className="relative group rounded-lg overflow-hidden bg-black"
      onMouseMove={resetControlsTimer}
      onMouseLeave={() => {
        if (isPlaying) setShowControls(false);
      }}
    >
      {/* Video Element */}
      <div className="aspect-video cursor-pointer" onClick={togglePlay}>
        <video
          ref={videoRef}
          src={src}
          className="w-full h-full"
          preload="metadata"
        />
      </div>

      {/* Play overlay when paused */}
      {!isPlaying && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/20"
          onClick={togglePlay}
        >
          <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
            <Play className="h-7 w-7 text-black ml-1" />
          </div>
        </div>
      )}

      {/* Controls overlay */}
      <div
        className={`absolute bottom-0 left-0 right-0 transition-opacity duration-300 ${
          showControls || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{
          background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
        }}
      >
        {/* Chapter Progress Bar */}
        <div className="px-3 pt-6">
          <div
            ref={progressRef}
            className="relative h-[6px] flex gap-[2px] cursor-pointer group/progress"
            onClick={handleProgressClick}
            onMouseMove={handleProgressHover}
            onMouseLeave={handleProgressLeave}
            style={{ height: "6px" }}
          >
            {segments.map((seg, i) => {
              const segWidth = seg.end - seg.start;
              const isActive = i === activeChapter;
              const isHovered = i === hoveredChapter;

              // Calculate filled portion within this segment
              let fillPercent = 0;
              if (progressPercent >= seg.end) {
                fillPercent = 100;
              } else if (progressPercent > seg.start) {
                fillPercent = ((progressPercent - seg.start) / (seg.end - seg.start)) * 100;
              }

              return (
                <div
                  key={i}
                  className="relative rounded-full overflow-hidden transition-all duration-150"
                  style={{
                    width: `${segWidth}%`,
                    height: isHovered ? "10px" : "6px",
                    marginTop: isHovered ? "-2px" : "0",
                    backgroundColor: "rgba(255,255,255,0.2)",
                  }}
                >
                  {/* Filled portion */}
                  <div
                    className="absolute top-0 left-0 h-full rounded-full transition-colors"
                    style={{
                      width: `${fillPercent}%`,
                      backgroundColor: isActive ? "#00F2FF" : "#ffffff",
                    }}
                  />
                </div>
              );
            })}

            {/* Hover tooltip */}
            {hoverTime !== null && (
              <div
                className="absolute bottom-full mb-3 transform -translate-x-1/2 pointer-events-none z-10"
                style={{ left: `${hoverX}px` }}
              >
                <div className="bg-black/95 text-white text-xs rounded-md px-3 py-2 whitespace-nowrap shadow-lg border border-white/10">
                  <div className="font-bold text-[11px]">{formatTime(hoverTime)}</div>
                  {hoveredChapter !== null && sortedChapters[hoveredChapter] && (
                    <div className="text-[#00F2FF] text-[10px] mt-0.5 max-w-[200px] truncate">
                      {sortedChapters[hoveredChapter].title}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Chapter title */}
        {sortedChapters[activeChapter] && (
          <div className="px-3 pt-1.5">
            <span className="text-white/70 text-[11px] font-medium">
              {sortedChapters[activeChapter].title}
            </span>
          </div>
        )}

        {/* Controls Bar */}
        <div className="flex items-center gap-2 px-3 py-2 text-white">
          {/* Play/Pause */}
          <button onClick={togglePlay} className="hover:scale-110 transition-transform p-1">
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>

          {/* Skip Previous */}
          <button onClick={() => skipChapter(-1)} className="hover:scale-110 transition-transform p-1">
            <SkipBack className="h-4 w-4" />
          </button>

          {/* Skip Next */}
          <button onClick={() => skipChapter(1)} className="hover:scale-110 transition-transform p-1">
            <SkipForward className="h-4 w-4" />
          </button>

          {/* Volume */}
          <div className="flex items-center gap-1 group/vol">
            <button onClick={toggleMute} className="hover:scale-110 transition-transform p-1">
              {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-0 group-hover/vol:w-16 transition-all duration-200 accent-[#00F2FF] h-1 cursor-pointer"
            />
          </div>

          {/* Time */}
          <span className="text-xs text-white/80 font-mono ml-1">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="flex-1" />

          {/* Fullscreen */}
          <button onClick={toggleFullscreen} className="hover:scale-110 transition-transform p-1">
            <Maximize className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Chapter list below video */}
      {sortedChapters.length > 0 && (
        <div className="bg-[var(--card)] border-t border-[var(--border)]">
          <div className="flex overflow-x-auto gap-0 scrollbar-thin">
            {sortedChapters.map((ch, i) => (
              <button
                key={i}
                onClick={() => seekTo(ch.timeSeconds)}
                className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 text-left border-r border-[var(--border)] last:border-r-0 transition-colors ${
                  i === activeChapter
                    ? "bg-[#00F2FF]/10 text-[#00F2FF]"
                    : "hover:bg-[var(--accent)] text-[var(--muted-foreground)]"
                }`}
              >
                <span className="text-[10px] font-mono opacity-70">{formatTime(ch.timeSeconds)}</span>
                <span className="text-xs font-medium truncate max-w-[150px]">{ch.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
