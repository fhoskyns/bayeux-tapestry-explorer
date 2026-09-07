'use client';

import { Pause, Play } from 'lucide-react';
import { useId } from 'react';
import { Slider } from '@/components/ui/slider';
import { AUTO_PAN_SPEEDS } from '@/lib/auto-pan';

export function AutoPanControl({ playing, notch, onNotchChange, onToggle }: {
  playing: boolean;
  notch: number;
  onNotchChange: (notch: number) => void;
  onToggle: () => void;
}) {
  const id = useId();
  return <div className="auto-pan-control">
    <div className="auto-pan-dial">
      <span className="sr-only" id={`${id}-label`}>Auto-pan speed</span>
      <Slider aria-labelledby={`${id}-label ${id}-value`} className="auto-pan-slider"
        largeStep={1} min={1} max={4} step={1} thumbAlignment="center" value={[notch]}
        onValueChange={(value) => onNotchChange(Math.max(1, Math.min(4, Math.round(Array.isArray(value) ? value[0] : value))))} />
      <span aria-hidden="true" className="auto-pan-notches">{AUTO_PAN_SPEEDS.map((speed) => <i key={speed.label} />)}</span>
      <span className="auto-pan-speed-name" id={`${id}-value`}>{AUTO_PAN_SPEEDS[notch - 1].label}</span>
    </div>
    <button aria-label={playing ? 'Pause auto-pan' : 'Play auto-pan'} className="auto-pan-play" onClick={onToggle} type="button">
      {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
    </button>
    <span className="auto-pan-label">Auto-pan</span>
  </div>;
}
