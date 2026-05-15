import { useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { LOOK_UP_BG_URL, PROLOGUE_VIDEO_URL, WAITING_BG_URL } from '../lib/assets';
import { getReactionCaptureTimeSeconds } from '../lib/config';
import { generateReactionResultCardDataUrl } from '../lib/reactionCard';
import {
  fetchShowControlRow,
  getShowControlStartAtMs,
  onShowControlRowChange,
  type ShowControlRow
} from '../lib/showControl';
import {
  createShowControlChannel,
  getSupabaseDevelopmentWarning,
  isSupabaseConfigured,
  onShowControlEvent,
  supabase,
  trackAudienceStatus,
  type AudienceStatus
} from '../lib/supabase';

type CameraState = 'not-started' | 'requesting' | 'granted' | 'denied';
type VideoState = 'idle' | 'loading' | 'ready' | 'error';
type PlaybackState = 'waiting' | 'playing' | 'blocked' | 'result' | 'stopped';

type VideoOverlayCue = {
  end: number;
  start: number;
  text: string;
};

const VIDEO_OVERLAY_CUES: VideoOverlayCue[] = [
  { start: 0, end: 4, text: '붉은 가면의 초대장' },
  { start: 14, end: 18, text: '손님 확인 중...' },
  { start: 19, end: 21, text: '가면 정보가 일치하지 않습니다.' },
  { start: 22, end: 24, text: '다시 확인합니다.' },
  { start: 26, end: 28, text: '인식값이 불안정합니다.' },
  { start: 28.5, end: 30.5, text: '후방에서 다른 얼굴이 감지되었습니다.' },
  { start: 35, end: 37, text: '확인 완료' },
  { start: 39, end: 43, text: '당신은 이미 초대되었습니다.' },
];

function getOverlayTextForTime(currentTime: number) {
  return VIDEO_OVERLAY_CUES.find((cue) => currentTime >= cue.start && currentTime < cue.end)
    ?.text;
}

function getAudienceId() {
  const storageKey = 'red-mask-audience-id';
  const existingId = window.localStorage.getItem(storageKey);

  if (existingId) {
    return existingId;
  }

  const nextId = window.crypto.randomUUID();
  window.localStorage.setItem(storageKey, nextId);
  return nextId;
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function preloadVideo(videoElement: HTMLVideoElement, sourceUrl: string) {
  return new Promise<void>((resolve, reject) => {
    videoElement.preload = 'auto';
    videoElement.muted = false;
    videoElement.playsInline = true;
    videoElement.volume = 1;

    const hasRequestedSource = videoElement.getAttribute('src') === sourceUrl;

    if (hasRequestedSource && videoElement.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      resolve();
      return;
    }

    const handleReady = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error('Unable to preload the prologue video.'));
    };

    const cleanup = () => {
      videoElement.removeEventListener('canplay', handleReady);
      videoElement.removeEventListener('canplaythrough', handleReady);
      videoElement.removeEventListener('error', handleError);
    };

    videoElement.addEventListener('canplay', handleReady, { once: true });
    videoElement.addEventListener('canplaythrough', handleReady, { once: true });
    videoElement.addEventListener('error', handleError, { once: true });

    if (!hasRequestedSource) {
      videoElement.src = sourceUrl;
    }

    videoElement.load();
  });
}

async function attachCameraStreamToVideo(videoElement: HTMLVideoElement, stream: MediaStream) {
  videoElement.srcObject = stream;
  videoElement.muted = true;
  videoElement.playsInline = true;

  try {
    await videoElement.play();
  } catch {
    // The stream is still usable once metadata is available; capture can retry later.
  }
}

function captureCameraStill(videoElement: HTMLVideoElement) {
  const width = videoElement.videoWidth;
  const height = videoElement.videoHeight;

  if (!width || !height) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');

  if (!context) {
    return null;
  }

  context.drawImage(videoElement, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

export function AudiencePage() {
  const [cameraState, setCameraState] = useState<CameraState>('not-started');
  const [videoState, setVideoState] = useState<VideoState>('idle');
  const [playbackState, setPlaybackState] = useState<PlaybackState>('waiting');
  const [videoOverlayText, setVideoOverlayText] = useState<string | null>(null);
  const [resultCardImageUrl, setResultCardImageUrl] = useState<string | null>(null);
  const [isGeneratingResultCard, setIsGeneratingResultCard] = useState(false);
  const [hasResultCardError, setHasResultCardError] = useState(false);
  const [hasShownPermissionNotice, setHasShownPermissionNotice] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const audienceIdRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoStateRef = useRef<VideoState>('idle');
  const playbackStateRef = useRef<PlaybackState>('waiting');
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const capturedReactionImageUrlRef = useRef<string | null>(null);
  const hasCapturedReactionRef = useRef(false);
  const hasPendingStartRef = useRef(false);
  const pendingStartAtRef = useRef<number | null>(null);
  const activeStartAtRef = useRef<number | null>(null);
  const startTimeoutRef = useRef<number | null>(null);
  const reactionCaptureAtRef = useRef<number | null>(null);

  const trackStatus = (status: AudienceStatus) => {
    if (channelRef.current && audienceIdRef.current) {
      void trackAudienceStatus(channelRef.current, audienceIdRef.current, status);
    }
  };

  const clearScheduledStart = () => {
    if (startTimeoutRef.current !== null) {
      window.clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
  };

  const startPrologueVideo = async (startAt?: number) => {
    const scheduledStartAt = typeof startAt === 'number' ? startAt : null;
    const isDuplicateStart =
      scheduledStartAt !== null && activeStartAtRef.current === scheduledStartAt;

    if (isDuplicateStart && playbackStateRef.current === 'playing') {
      return;
    }

    if (isDuplicateStart && hasPendingStartRef.current && startTimeoutRef.current !== null) {
      return;
    }

    if (scheduledStartAt !== null && scheduledStartAt > Date.now()) {
      clearScheduledStart();
      hasPendingStartRef.current = true;
      pendingStartAtRef.current = scheduledStartAt;
      activeStartAtRef.current = scheduledStartAt;
      startTimeoutRef.current = window.setTimeout(() => {
        startTimeoutRef.current = null;
        void startPrologueVideo(scheduledStartAt);
      }, scheduledStartAt - Date.now());
      return;
    }

    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    if (videoStateRef.current !== 'ready') {
      hasPendingStartRef.current = true;
      pendingStartAtRef.current = scheduledStartAt;
      activeStartAtRef.current = scheduledStartAt;
      return;
    }

    clearScheduledStart();
    hasPendingStartRef.current = false;
    pendingStartAtRef.current = null;
    activeStartAtRef.current = scheduledStartAt;
    hasCapturedReactionRef.current = false;
    capturedReactionImageUrlRef.current = null;
    setResultCardImageUrl(null);
    setHasResultCardError(false);
    playbackStateRef.current = 'playing';
    setPlaybackState('playing');

    videoElement.muted = false;
    videoElement.volume = 1;
    videoElement.currentTime = 0;
    setVideoOverlayText(getOverlayTextForTime(0) ?? null);

    try {
      await videoElement.play();
      trackStatus('PLAYING');
    } catch {
      playbackStateRef.current = 'blocked';
      setPlaybackState('blocked');
    }
  };

  const resetPrologueVideo = () => {
    const videoElement = videoRef.current;

    clearScheduledStart();
    hasPendingStartRef.current = false;
    pendingStartAtRef.current = null;
    activeStartAtRef.current = null;
    reactionCaptureAtRef.current = null;
    hasCapturedReactionRef.current = false;
    capturedReactionImageUrlRef.current = null;
    setResultCardImageUrl(null);
    setIsGeneratingResultCard(false);
    setHasResultCardError(false);
    setVideoOverlayText(null);
    playbackStateRef.current = 'waiting';
    setPlaybackState('waiting');
    trackStatus('WAITING');

    if (!videoElement) {
      return;
    }

    videoElement.pause();
    videoElement.currentTime = 0;
  };

  const emergencyStopPrologueVideo = () => {
    const videoElement = videoRef.current;

    clearScheduledStart();
    hasPendingStartRef.current = false;
    pendingStartAtRef.current = null;
    activeStartAtRef.current = null;
    hasCapturedReactionRef.current = false;
    setVideoOverlayText(null);
    playbackStateRef.current = 'stopped';
    setPlaybackState('stopped');

    if (!videoElement) {
      return;
    }

    videoElement.pause();
  };

  const applyShowControlRow = (row: ShowControlRow) => {
    if (row.state === 'WAITING') {
      resetPrologueVideo();
      return;
    }

    if (row.state === 'STOPPED') {
      emergencyStopPrologueVideo();
      return;
    }

    if (row.state === 'PLAYING') {
      void startPrologueVideo(getShowControlStartAtMs(row));
    }
  };

  const syncShowControlRow = () => {
    void fetchShowControlRow().then(({ data }) => {
      if (data) {
        applyShowControlRow(data);
      }
    });
  };

  const handleVideoEnded = async () => {
    setVideoOverlayText(null);

    if (!hasCapturedReactionRef.current) {
      captureReactionImage();
    }

    playbackStateRef.current = 'result';
    setPlaybackState('result');
    trackStatus('RESULT');

    const capturedImageUrl = capturedReactionImageUrlRef.current;

    if (!capturedImageUrl) {
      if (cameraState !== 'denied') {
        console.error(
          '[reaction-capture] no image at video end: capture did not run or camera frame was not ready.'
        );
      }
      return;
    }

    setIsGeneratingResultCard(true);
    setHasResultCardError(false);

    try {
      const resultCardDataUrl = await generateReactionResultCardDataUrl(capturedImageUrl);
      setResultCardImageUrl(resultCardDataUrl);
    } catch (error) {
      console.error('[reaction-card] failed to generate result card:', error);
      setHasResultCardError(true);
    } finally {
      setIsGeneratingResultCard(false);
    }
  };

  const syncReactionCaptureTime = (videoElement: HTMLVideoElement) => {
    const duration = videoElement.duration;

    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }

    reactionCaptureAtRef.current = getReactionCaptureTimeSeconds(duration);
  };

  const captureReactionImage = (): boolean => {
    if (hasCapturedReactionRef.current) {
      return Boolean(capturedReactionImageUrlRef.current);
    }

    if (cameraState === 'denied') {
      hasCapturedReactionRef.current = true;
      console.error(
        '[reaction-capture] skipped: camera permission was denied by the user.'
      );
      return false;
    }

    const cameraVideoElement = cameraVideoRef.current;

    if (!cameraVideoElement) {
      console.error('[reaction-capture] failed: camera video element is not available.');
      return false;
    }

    const width = cameraVideoElement.videoWidth;
    const height = cameraVideoElement.videoHeight;

    if (!width || !height) {
      console.error(
        `[reaction-capture] failed: camera frame has no dimensions yet (width=${width}, height=${height}).`
      );
      return false;
    }

    const dataUrl = captureCameraStill(cameraVideoElement);

    if (!dataUrl) {
      console.error('[reaction-capture] failed: canvas drawImage returned no data URL.');
      return false;
    }

    hasCapturedReactionRef.current = true;
    capturedReactionImageUrlRef.current = dataUrl;
    return true;
  };

  useEffect(() => {
    return () => {
      clearScheduledStart();
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    playbackStateRef.current = playbackState;
  }, [playbackState]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }

    const audienceId = getAudienceId();
    const channel = createShowControlChannel(audienceId);

    if (!channel) {
      return;
    }

    audienceIdRef.current = audienceId;
    channelRef.current = channel;

    onShowControlRowChange(channel, applyShowControlRow);
    onShowControlEvent(channel, () => {
      syncShowControlRow();
    });

    channel.subscribe((subscriptionStatus) => {
      if (subscriptionStatus === 'SUBSCRIBED') {
        void trackAudienceStatus(channel, audienceId, 'WAITING');
      }
    });

    syncShowControlRow();

    return () => {
      void channel.untrack();
      void supabase?.removeChannel(channel);
      channelRef.current = null;
    };
  }, []);

  const cameraStatusMessage = cameraState === 'granted' ? '카메라 준비 완료' : '카메라 준비 전';
  const videoStatusMessage = videoState === 'ready' ? '영상 준비 완료' : '영상 로딩 중';
  const isPreparing = cameraState === 'requesting' || videoState === 'loading';
  const isEntranceReady = cameraState === 'granted' && videoState === 'ready';
  const canContinueWithoutCamera = cameraState === 'denied' && videoState === 'ready';
  const hasStartedPreparation = hasShownPermissionNotice || videoState !== 'idle';

  const primaryStatusMessage = useMemo(() => {
    if (isEntranceReady) {
      return '입장 준비 완료';
    }

    if (videoState === 'ready') {
      return '영상 준비 완료';
    }

    if (videoState === 'loading') {
      return '영상 로딩 중';
    }

    if (cameraState === 'granted') {
      return '카메라 준비 완료';
    }

    return '카메라 준비 전';
  }, [cameraState, isEntranceReady, videoState]);

  const handlePrepare = async () => {
    setHasShownPermissionNotice(true);
    setCameraState('requesting');
    videoStateRef.current = 'loading';
    setVideoState('loading');
    await waitForNextPaint();

    let cameraWasGranted = false;
    const videoPreloadPromise = (
      videoRef.current
        ? preloadVideo(videoRef.current, PROLOGUE_VIDEO_URL)
        : Promise.reject(new Error('Video element is not available.'))
    )
      .then(() => ({ isReady: true }))
      .catch(() => ({ isReady: false }));

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 720 },
          height: { ideal: 1280 }
        }
      });

      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraVideoRef.current?.pause();
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        void attachCameraStreamToVideo(cameraVideoRef.current, stream);
      }
      cameraWasGranted = true;
      setCameraState('granted');
      trackStatus('CAMERA_GRANTED');
    } catch {
      setCameraState('denied');
      trackStatus('CAMERA_DENIED');
    }

    try {
      const preloadResult = await videoPreloadPromise;

      if (!preloadResult.isReady) {
        throw new Error('Unable to preload the prologue video.');
      }

      videoStateRef.current = 'ready';
      setVideoState('ready');

      if (cameraWasGranted) {
        trackStatus('VIDEO_READY');
        trackStatus('READY');
      }

      if (hasPendingStartRef.current) {
        void startPrologueVideo(pendingStartAtRef.current ?? undefined);
      }
    } catch {
      videoStateRef.current = 'error';
      setVideoState('error');
    }
  };

  const handlePrologueVideoMetadata = () => {
    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    syncReactionCaptureTime(videoElement);
  };

  const handleVideoTimeUpdate = () => {
    const videoElement = videoRef.current;

    if (!videoElement) {
      return;
    }

    if (reactionCaptureAtRef.current === null) {
      syncReactionCaptureTime(videoElement);
    }

    setVideoOverlayText(getOverlayTextForTime(videoElement.currentTime) ?? null);

    const captureAt =
      reactionCaptureAtRef.current ?? getReactionCaptureTimeSeconds(videoElement.duration);

    if (videoElement.currentTime >= captureAt) {
      captureReactionImage();
    }
  };

  const handleSaveResultImage = () => {
    if (!resultCardImageUrl) {
      return;
    }

    const link = document.createElement('a');
    link.href = resultCardImageUrl;
    link.download = 'red-mask-reaction-card.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleReplayVideo = () => {
    void startPrologueVideo();
  };

  const developmentWarning = getSupabaseDevelopmentWarning();
  const pageBackgroundImage =
    playbackState === 'playing'
      ? 'none'
      : playbackState === 'result'
        ? `linear-gradient(180deg, rgba(0, 0, 0, 0.28) 0%, rgba(7, 2, 4, 0.64) 52%, rgba(0, 0, 0, 0.92) 100%), url(${LOOK_UP_BG_URL})`
        : `linear-gradient(180deg, rgba(3, 3, 4, 0.46) 0%, rgba(7, 2, 4, 0.74) 48%, rgba(0, 0, 0, 0.94) 100%), url(${WAITING_BG_URL})`;

  return (
    <section
      className={`audience-page audience-page--waiting audience-page--${playbackState}`}
      style={{
        backgroundImage: pageBackgroundImage
      }}
    >
      <video
        ref={videoRef}
        aria-hidden={playbackState !== 'playing'}
        className={`prologue-video prologue-video--${playbackState}`}
        onDurationChange={handlePrologueVideoMetadata}
        onEnded={() => void handleVideoEnded()}
        onLoadedMetadata={handlePrologueVideoMetadata}
        onTimeUpdate={handleVideoTimeUpdate}
        playsInline
        preload="auto"
      />

      <video
        ref={cameraVideoRef}
        aria-hidden="true"
        className="camera-capture-video"
        muted
        playsInline
      />

      {playbackState === 'playing' && videoOverlayText ? (
        <div className="video-time-overlay" aria-live="polite">
          {videoOverlayText}
        </div>
      ) : null}

      {playbackState === 'stopped' ? (
        <div className="safe-stop-panel" role="status">
          <p>체험이 중지되었습니다. 현장 안내에 따라주세요.</p>
        </div>
      ) : null}

      {playbackState === 'result' ? (
        <div className="reaction-result-panel" role="status">
          <h2 className="result-handoff-message">이제 고개를 들어주세요.</h2>
          {resultCardImageUrl ? (
            <img alt="Generated red mask reaction result card" src={resultCardImageUrl} />
          ) : cameraState === 'denied' ? (
            <p>카메라 권한이 없어 리액션 이미지는 저장되지 않았습니다.</p>
          ) : isGeneratingResultCard ? (
            <p>결과 이미지를 생성 중입니다.</p>
          ) : hasResultCardError ? (
            <p>결과 이미지를 생성하지 못했습니다.</p>
          ) : (
            <p>리액션 이미지를 생성하지 못했습니다.</p>
          )}
          <div className="result-actions">
            <button
              className="primary-action"
              disabled={!resultCardImageUrl}
              onClick={handleSaveResultImage}
              type="button"
            >
              이미지 저장하기
            </button>
            <button className="secondary-action" onClick={handleReplayVideo} type="button">
              다시 보기
            </button>
          </div>
          {resultCardImageUrl ? (
            <p className="iphone-save-instruction">
              아이폰에서는 이미지를 길게 눌러 사진 앱에 저장하세요.
            </p>
          ) : null}
        </div>
      ) : null}

      {playbackState !== 'playing' && playbackState !== 'result' && playbackState !== 'stopped' ? (
        <div className="audience-waiting">
          <div className="audience-waiting__content">
            <p className="audience-kicker">Red Mask Invitation</p>
            <h1>붉은 가면의 초대장</h1>
            <p>공연 시작 전까지 이 화면을 닫지 마세요.</p>
          </div>

          {hasShownPermissionNotice ? (
            <p className="permission-notice">
              본 체험은 공연 연출 및 기념 콘텐츠 생성을 위해 카메라를 사용합니다.
              촬영된 이미지는 사용자 기기에서만 확인 및 저장할 수 있습니다.
            </p>
          ) : null}

          <div className="audience-status-panel" aria-live="polite">
            <p className="audience-status-panel__primary">{primaryStatusMessage}</p>
            <div className="audience-status-list">
              <span className={cameraState === 'granted' ? 'is-ready' : undefined}>
                {cameraStatusMessage}
              </span>
              {hasStartedPreparation ? (
                <span className={videoState === 'ready' ? 'is-ready' : undefined}>
                  {videoStatusMessage}
                </span>
              ) : null}
              {isEntranceReady ? <strong>입장 준비 완료</strong> : null}
            </div>
          </div>

          {cameraState === 'denied' ? (
            <p className="camera-denied-notice">
              카메라 권한이 없어 리액션 이미지는 저장되지 않습니다. 영상은 계속 볼 수
              있습니다.
            </p>
          ) : null}

          {playbackState === 'blocked' ? (
            <button
              className="primary-action"
              onClick={() => void startPrologueVideo()}
              type="button"
            >
              영상 시작하기
            </button>
          ) : (
            <button
              className="primary-action"
              disabled={isPreparing || isEntranceReady || canContinueWithoutCamera}
              onClick={handlePrepare}
              type="button"
            >
              초대장 준비하기
            </button>
          )}

          {developmentWarning ? <p className="development-warning">{developmentWarning}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
