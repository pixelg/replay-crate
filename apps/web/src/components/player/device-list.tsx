import type { Device } from '@replay-crate/api-client'
import { Laptop, MonitorSpeaker, Smartphone, Speaker, Tv, type LucideIcon } from 'lucide-react'
import { Button } from '../ui/button.tsx'

const ICONS: Record<string, LucideIcon> = { Computer: Laptop, Smartphone, Speaker, TV: Tv }

/** Spotify Connect devices; any but the active one can take over playback. */
export function DeviceList({ devices, onPlayHere }: { devices: Device[]; onPlayHere: (deviceId: string) => void }) {
  if (!devices.length) {
    return <p className="text-sm text-muted-foreground">No devices found. Open Spotify on a phone, computer or speaker.</p>
  }
  return (
    <ul className="flex flex-col">
      {devices.map((device) => {
        const Icon = ICONS[device.type] ?? MonitorSpeaker
        return (
          <li key={device.id ?? device.name} className="flex items-center gap-3 py-2">
            <Icon aria-hidden className={device.isActive ? 'size-5 text-primary' : 'size-5 text-muted-foreground'} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium">{device.name}</p>
              <p className="text-xs text-muted-foreground">
                {device.isActive ? 'Playing here' : device.type}
                {device.supportsVolume && device.volumePercent !== null && ` · ${device.volumePercent}% volume`}
              </p>
            </div>
            {!device.isActive && device.id && (
              <Button
                size="sm"
                variant="secondary"
                disabled={device.isRestricted}
                onClick={() => onPlayHere(device.id!)}
                aria-label={`Play on ${device.name}`}
              >
                Play here
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
