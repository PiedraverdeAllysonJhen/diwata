type PortalLiveIndicatorProps = {
  isSyncing: boolean;
  text: string;
};

export default function PortalLiveIndicator({ isSyncing, text }: PortalLiveIndicatorProps) {
  return (
    <p className={`live-indicator ${isSyncing ? "syncing" : ""}`.trim()}>
      <span className="live-dot" aria-hidden="true" />
      {text}
    </p>
  );
}
