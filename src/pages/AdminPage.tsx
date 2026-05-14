import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { StatusPill } from '../components/StatusPill';
import { showConfig } from '../lib/showConfig';
import {
  callShowControlFunction,
  fetchShowControlRow,
  getShowControlStartAtMs,
  onShowControlRowChange,
  type ShowControlEvent,
  type ShowControlFunctionAction,
  type ShowControlRow,
  type ShowControlState
} from '../lib/showControl';
import {
  AUDIENCE_STATUSES,
  broadcastShowControlEvent,
  createShowControlChannel,
  getSupabaseDevelopmentWarning,
  isSupabaseConfigured,
  supabase,
  type AudiencePresence,
  type AudienceStatus
} from '../lib/supabase';

type ShowState = ShowControlState | 'RESULT';
type StartCountdownLabel = '3' | '2' | '1' | 'START' | null;

type PresenceSummary = {
  cameraDeniedCount: number;
  cameraGrantedCount: number;
  connectedAudienceCount: number;
  readyAudienceCount: number;
  statusCounts: Record<AudienceStatus, number>;
};

type AdminActionLog = {
  id: string;
  label: string;
  time: string;
};

const ADMIN_PIN_SESSION_STORAGE_KEY = 'red-mask-admin-pin';

const emptyPresenceCounts = AUDIENCE_STATUSES.reduce(
  (counts, status) => ({
    ...counts,
    [status]: 0
  }),
  {} as Record<AudienceStatus, number>
);

const emptyPresenceSummary: PresenceSummary = {
  cameraDeniedCount: 0,
  cameraGrantedCount: 0,
  connectedAudienceCount: 0,
  readyAudienceCount: 0,
  statusCounts: emptyPresenceCounts
};

function summarizePresence(presenceState: Record<string, AudiencePresence[]>): PresenceSummary {
  const latestPresences = Object.values(presenceState)
    .map((presences) => presences[presences.length - 1])
    .filter((presence): presence is AudiencePresence => Boolean(presence));

  const statusCounts = { ...emptyPresenceCounts };

  latestPresences.forEach((presence) => {
    statusCounts[presence.status] += 1;
  });

  return {
    cameraDeniedCount: statusCounts.CAMERA_DENIED,
    cameraGrantedCount:
      statusCounts.CAMERA_GRANTED +
      statusCounts.VIDEO_READY +
      statusCounts.READY +
      statusCounts.PLAYING +
      statusCounts.RESULT,
    connectedAudienceCount: latestPresences.length,
    readyAudienceCount: statusCounts.READY + statusCounts.PLAYING + statusCounts.RESULT,
    statusCounts
  };
}

function getStoredAdminPin() {
  try {
    return window.sessionStorage.getItem(ADMIN_PIN_SESSION_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeAdminPin(pin: string) {
  try {
    window.sessionStorage.setItem(ADMIN_PIN_SESSION_STORAGE_KEY, pin);
  } catch {
    // If sessionStorage is blocked, keep the PIN only in React state.
  }
}

function clearStoredAdminPin() {
  try {
    window.sessionStorage.removeItem(ADMIN_PIN_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures when locking the local console.
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }

  return 'unknown error';
}

function getFriendlyControlError(status: number, error: unknown) {
  if (status === 401) {
    return 'PIN이 올바르지 않습니다. 다시 입력해주세요.';
  }

  if (status === 0) {
    return '운영 명령을 보낼 수 없습니다. 네트워크와 Supabase 설정을 확인해주세요.';
  }

  return `운영 명령 실패: ${getErrorMessage(error)}`;
}

export function AdminPage() {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const controlActionInFlightRef = useRef(false);
  const startCountdownIntervalRef = useRef<number | null>(null);
  const startCountdownHideTimeoutRef = useRef<number | null>(null);
  const [adminPin, setAdminPin] = useState(getStoredAdminPin);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(() => Boolean(getStoredAdminPin()));
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showState, setShowState] = useState<ShowState>('WAITING');
  const [isConfirmingStart, setIsConfirmingStart] = useState(false);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [isConfirmingEmergencyStop, setIsConfirmingEmergencyStop] = useState(false);
  const [isStartInProgress, setIsStartInProgress] = useState(false);
  const [startCountdownLabel, setStartCountdownLabel] = useState<StartCountdownLabel>(null);
  const [hasObservedPlayingAudience, setHasObservedPlayingAudience] = useState(false);
  const [presenceSummary, setPresenceSummary] = useState(emptyPresenceSummary);
  const [actionLog, setActionLog] = useState<AdminActionLog[]>([]);

  const clearStartCountdownTimers = () => {
    if (startCountdownIntervalRef.current !== null) {
      window.clearInterval(startCountdownIntervalRef.current);
      startCountdownIntervalRef.current = null;
    }

    if (startCountdownHideTimeoutRef.current !== null) {
      window.clearTimeout(startCountdownHideTimeoutRef.current);
      startCountdownHideTimeoutRef.current = null;
    }
  };

  const clearStartCountdown = () => {
    clearStartCountdownTimers();
    setStartCountdownLabel(null);
  };

  useEffect(() => {
    return () => {
      clearStartCountdownTimers();
    };
  }, []);

  useEffect(() => {
    if (!isAdminUnlocked || !isSupabaseConfigured) {
      return;
    }

    const channel = createShowControlChannel();

    if (!channel) {
      return;
    }

    channelRef.current = channel;

    onShowControlRowChange(channel, applyPersistedShowControlRow);

    channel.on('presence', { event: 'sync' }, () => {
      setPresenceSummary(
        summarizePresence(channel.presenceState() as Record<string, AudiencePresence[]>)
      );
    });

    channel.subscribe((subscriptionStatus) => {
      setIsConnected(subscriptionStatus === 'SUBSCRIBED');
    });

    void fetchShowControlRow().then(({ data, error }) => {
      if (data) {
        applyPersistedShowControlRow(data);
        return;
      }

      if (error) {
        addActionLog(`show_control fetch failed: ${getErrorMessage(error)}`);
      }
    });

    return () => {
      void supabase?.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
      setPresenceSummary(emptyPresenceSummary);
    };
  }, [isAdminUnlocked]);

  useEffect(() => {
    if (showState === 'PLAYING' && presenceSummary.statusCounts.PLAYING > 0) {
      setHasObservedPlayingAudience(true);
    }
  }, [presenceSummary.statusCounts.PLAYING, showState]);

  useEffect(() => {
    if (
      showState === 'PLAYING' &&
      hasObservedPlayingAudience &&
      presenceSummary.statusCounts.RESULT > 0 &&
      presenceSummary.statusCounts.PLAYING === 0
    ) {
      setShowState('RESULT');
    }
  }, [
    hasObservedPlayingAudience,
    presenceSummary.statusCounts.PLAYING,
    presenceSummary.statusCounts.RESULT,
    showState
  ]);

  const addActionLog = (label: string) => {
    setActionLog((currentLog) =>
      [
        {
          id: window.crypto.randomUUID(),
          label,
          time: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          })
        },
        ...currentLog
      ].slice(0, 10)
    );
  };

  const runStartCountdown = (startAt: number) => {
    clearStartCountdownTimers();
    setIsStartInProgress(true);

    const updateCountdown = () => {
      const remainingMs = startAt - Date.now();

      if (remainingMs > 2000) {
        setStartCountdownLabel('3');
        return;
      }

      if (remainingMs > 1000) {
        setStartCountdownLabel('2');
        return;
      }

      if (remainingMs > 0) {
        setStartCountdownLabel('1');
        return;
      }

      clearStartCountdownTimers();
      setStartCountdownLabel('START');
      setShowState('PLAYING');
      setIsStartInProgress(false);

      startCountdownHideTimeoutRef.current = window.setTimeout(() => {
        setStartCountdownLabel(null);
      }, 900);
    };

    updateCountdown();
    startCountdownIntervalRef.current = window.setInterval(updateCountdown, 100);
  };

  const applyPersistedShowControlRow = (row: ShowControlRow) => {
    if (row.state === 'PLAYING') {
      const startAt = getShowControlStartAtMs(row);

      setHasObservedPlayingAudience(false);

      if (typeof startAt === 'number' && startAt > Date.now()) {
        runStartCountdown(startAt);
      } else {
        clearStartCountdown();
        setIsStartInProgress(false);
        setShowState('PLAYING');
      }

      return;
    }

    if (row.state === 'WAITING') {
      clearStartCountdown();
      setIsStartInProgress(false);
      setHasObservedPlayingAudience(false);
      setShowState('WAITING');
      return;
    }

    if (row.state === 'STOPPED') {
      clearStartCountdown();
      setIsStartInProgress(false);
      setHasObservedPlayingAudience(false);
      setShowState('STOPPED');
    }
  };

  const handleControlAction = async (action: ShowControlFunctionAction) => {
    if (controlActionInFlightRef.current) {
      return null;
    }

    controlActionInFlightRef.current = true;
    setCommandError(null);

    if (!adminPin.trim()) {
      setCommandError('운영자 PIN을 다시 입력해주세요.');
      setIsAdminUnlocked(false);
      controlActionInFlightRef.current = false;
      return null;
    }

    const { data, error, status } = await callShowControlFunction(adminPin.trim(), action);

    if (error) {
      const message = getFriendlyControlError(status, error);
      setCommandError(message);
      addActionLog(`${action} failed: ${getErrorMessage(error)}`);

      if (status === 401) {
        clearStoredAdminPin();
        setAdminPin('');
        setIsAdminUnlocked(false);
        setPinError(message);
      }

      controlActionInFlightRef.current = false;
      return null;
    }

    storeAdminPin(adminPin.trim());
    addActionLog(action === 'VERIFY' ? 'PIN verified' : `${action} saved`);
    controlActionInFlightRef.current = false;
    return data;
  };

  const handleBroadcast = async (
    event: ShowControlEvent,
    payload?: { startAt?: number }
  ) => {
    if (!channelRef.current) {
      addActionLog(`${event} broadcast skipped: realtime not connected`);
      return false;
    }

    const response = await broadcastShowControlEvent(channelRef.current, event, payload);

    if (response !== 'ok') {
      addActionLog(`${event} broadcast failed: ${response}`);
      return false;
    }

    addActionLog(`${event} broadcast`);
    return true;
  };

  const handlePinSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextPin = pinInput.trim();

    if (!nextPin) {
      setPinError('운영자 PIN을 입력해주세요.');
      return;
    }

    setPinError(null);
    setCommandError(null);
    setIsVerifyingPin(true);
    setAdminPin(nextPin);
    controlActionInFlightRef.current = true;

    const { error, status } = await callShowControlFunction(nextPin, 'VERIFY');
    controlActionInFlightRef.current = false;
    setIsVerifyingPin(false);

    if (error) {
      setAdminPin('');
      clearStoredAdminPin();
      setPinError(getFriendlyControlError(status, error));
      return;
    }

    storeAdminPin(nextPin);
    setIsAdminUnlocked(true);
    setPinInput('');
    addActionLog('PIN verified');
  };

  const handleLockConsole = () => {
    clearStoredAdminPin();
    clearStartCountdown();
    setAdminPin('');
    setIsAdminUnlocked(false);
    setPinInput('');
    setPinError(null);
    setCommandError(null);
    setIsConfirmingStart(false);
    setIsConfirmingReset(false);
    setIsConfirmingEmergencyStop(false);
    setIsStartInProgress(false);
    controlActionInFlightRef.current = false;
  };

  const handleStartClick = async () => {
    if (
      !isSupabaseConfigured ||
      showState === 'PLAYING' ||
      isStartInProgress ||
      startCountdownLabel ||
      controlActionInFlightRef.current
    ) {
      return;
    }

    if (!isConfirmingStart) {
      setIsConfirmingStart(true);
      setIsConfirmingReset(false);
      setIsConfirmingEmergencyStop(false);
      addActionLog('START confirmation opened');
      return;
    }

    setIsConfirmingStart(false);
    setIsStartInProgress(true);
    setHasObservedPlayingAudience(false);

    const row = await handleControlAction('START');

    if (!row) {
      setIsStartInProgress(false);
      clearStartCountdown();
      return;
    }

    applyPersistedShowControlRow(row);
    await handleBroadcast('START', { startAt: getShowControlStartAtMs(row) });
    addActionLog('START scheduled: 3-second countdown');
  };

  const handleReset = async () => {
    if (!isSupabaseConfigured) {
      return;
    }

    if (!isConfirmingReset) {
      setIsConfirmingReset(true);
      setIsConfirmingStart(false);
      setIsConfirmingEmergencyStop(false);
      addActionLog('RESET confirmation opened');
      return;
    }

    clearStartCountdown();
    setIsStartInProgress(false);
    setIsConfirmingReset(false);

    const row = await handleControlAction('RESET');

    if (!row) {
      return;
    }

    applyPersistedShowControlRow(row);
    await handleBroadcast('RESET');
  };

  const handleEmergencyStop = async () => {
    if (!isSupabaseConfigured) {
      return;
    }

    if (!isConfirmingEmergencyStop) {
      setIsConfirmingEmergencyStop(true);
      setIsConfirmingStart(false);
      setIsConfirmingReset(false);
      addActionLog('EMERGENCY STOP confirmation opened');
      return;
    }

    clearStartCountdown();
    setIsStartInProgress(false);
    setIsConfirmingEmergencyStop(false);

    const row = await handleControlAction('EMERGENCY_STOP');

    if (!row) {
      return;
    }

    applyPersistedShowControlRow(row);
    await handleBroadcast('EMERGENCY_STOP');
  };

  const developmentWarning = getSupabaseDevelopmentWarning();
  const connectionLabel = isConnected ? 'Supabase 연결됨' : 'Supabase 연결 안 됨';
  const isControlUnavailable = !isSupabaseConfigured || !adminPin.trim();
  const isStartDisabled =
    isControlUnavailable ||
    showState === 'PLAYING' ||
    isStartInProgress ||
    Boolean(startCountdownLabel);

  const metricCards = [
    {
      label: '현재 상태',
      value: showState
    },
    {
      label: '접속자',
      value: presenceSummary.connectedAudienceCount
    },
    {
      label: '준비 완료',
      value: presenceSummary.readyAudienceCount
    },
    {
      label: '카메라 허용',
      value: presenceSummary.cameraGrantedCount
    },
    {
      label: '카메라 거부',
      value: presenceSummary.cameraDeniedCount
    }
  ];

  if (!isAdminUnlocked) {
    return (
      <section className="admin-page admin-page--locked">
        <form className="admin-pin-card" onSubmit={(event) => void handlePinSubmit(event)}>
          <div>
            <p className="eyebrow">Director access</p>
            <h1>Show Control</h1>
          </div>
          <label htmlFor="admin-pin">운영자 PIN</label>
          <input
            autoComplete="one-time-code"
            id="admin-pin"
            inputMode="numeric"
            onChange={(event) => setPinInput(event.target.value)}
            placeholder="운영자 PIN"
            type="password"
            value={pinInput}
          />
          {pinError ? (
            <p className="admin-pin-message admin-pin-message--error">{pinError}</p>
          ) : null}
          {developmentWarning ? (
            <p className="admin-pin-message admin-pin-message--warning">{developmentWarning}</p>
          ) : null}
          <button className="primary-action" disabled={isVerifyingPin} type="submit">
            {isVerifyingPin ? '확인 중' : '운영 콘솔 열기'}
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="admin-page admin-page--operator">
      <div className="admin-console">
        <header className="admin-console__header">
          <div>
            <p className="eyebrow">Phone show control</p>
            <h1>Show Control</h1>
          </div>
          <button className="lock-button" onClick={handleLockConsole} type="button">
            잠금
          </button>
        </header>

        <div className="admin-connection-row">
          <StatusPill label={connectionLabel} tone={isConnected ? 'ready' : 'danger'} />
          <span>{showConfig.realtimeChannel}</span>
        </div>

        <section className="admin-state-grid" aria-label="Show state and audience counts">
          {metricCards.map((metric) => (
            <div className="admin-state-card" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </section>

        {commandError ? <p className="admin-command-error">{commandError}</p> : null}

        <div className="show-command admin-live-controls">
          {startCountdownLabel ? (
            <div className="admin-countdown" aria-live="assertive">
              <strong>{startCountdownLabel}</strong>
              <span>관객 영상 시작</span>
            </div>
          ) : null}
          <button
            className={`start-button ${isConfirmingStart ? 'start-button--confirming' : ''}`}
            disabled={isStartDisabled}
            onClick={() => void handleStartClick()}
            type="button"
          >
            {isConfirmingStart ? '정말 시작합니다' : 'START'}
          </button>
          <div className="operator-actions">
            <button
              className={`secondary-action ${
                isConfirmingReset ? 'secondary-action--confirming' : ''
              }`}
              disabled={isControlUnavailable}
              onClick={() => void handleReset()}
              type="button"
            >
              {isConfirmingReset ? '정말 초기화합니다' : 'RESET'}
            </button>
            <button
              className={`secondary-action secondary-action--danger ${
                isConfirmingEmergencyStop ? 'secondary-action--confirming-danger' : ''
              }`}
              disabled={isControlUnavailable}
              onClick={() => void handleEmergencyStop()}
              type="button"
            >
              {isConfirmingEmergencyStop ? '정말 중지합니다' : 'EMERGENCY STOP'}
            </button>
          </div>
        </div>

        <section className="admin-action-log" aria-label="Admin action log">
          <div className="admin-action-log__header">
            <h2>Action Log</h2>
            <span>last 10</span>
          </div>
          {actionLog.length > 0 ? (
            <ol>
              {actionLog.map((action) => (
                <li key={action.id}>
                  <span>{action.time}</span>
                  <strong>{action.label}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p>No admin actions yet.</p>
          )}
        </section>

        <div className="console-list console-list--compact" aria-label="Audience presence detail">
          {AUDIENCE_STATUSES.map((status) => (
            <div className="console-row" key={status}>
              <span>{status}</span>
              <strong>{presenceSummary.statusCounts[status]}</strong>
            </div>
          ))}
        </div>

        {developmentWarning ? <p className="development-warning">{developmentWarning}</p> : null}
      </div>
    </section>
  );
}
