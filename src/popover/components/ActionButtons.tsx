import { ChartIcon, GearIcon } from './icons.js';

interface ActionButtonsProps {
  onOpenDashboard: () => void;
  onOpenSettings: () => void;
}

export function ActionButtons({ onOpenDashboard, onOpenSettings }: ActionButtonsProps) {
  return (
    <div className="actions">
      <button type="button" onClick={onOpenDashboard} title="Open web dashboard">
        <ChartIcon />
        Dashboard
      </button>
      <button type="button" onClick={onOpenSettings} title="Open settings">
        <GearIcon />
        Settings
      </button>
    </div>
  );
}