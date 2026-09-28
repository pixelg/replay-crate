import { isApiError, type Device } from '@replay-crate/api-client'
import { formatRelative } from '@replay-crate/core'
import { Car, Laptop, MonitorSpeaker, MoreHorizontal, Smartphone, Speaker, Trash2, Tv, type LucideIcon } from 'lucide-react'
import { describeError } from '../../lib/describe-error.ts'
import { Button } from '../ui/button.tsx'
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '../ui/menu.tsx'

const ICONS: Record<string, LucideIcon> = { Computer: Laptop, Smartphone, Speaker, TV: Tv, Automobile: Car }

/** A device Spotify wouldn't play on, and why. */
export type DeviceRefusal = { deviceId: string; error: unknown }

/**
 * Spotify Connect devices: those with Spotify open now, where any but the active one can take
 * over playback, then the ones played on before. Those can be tried (Spotify refuses until
 * Spotify is open there) or forgotten.
 */
export function DeviceList({
  devices,
  onPlayHere,
  onForget,
  refusal,
}: {
  devices: Device[]
  /** Moves playback to a device; also how a device played on before is tried. */
  onPlayHere: (deviceId: string) => void
  onForget: (device: Device) => void
  /** Shown on the device's row rather than for the whole page. */
  refusal?: DeviceRefusal | null
}) {
  const available = devices.filter((device) => device.isAvailable)
  const before = devices.filter((device) => !device.isAvailable)

  return (
    <div className="flex flex-col gap-4">
      {available.length ? (
        <ul className="flex flex-col">
          {available.map((device) => {
            const Icon = ICONS[device.type] ?? MonitorSpeaker
            return (
              <li key={device.rememberedId} className="flex items-center gap-3 py-2">
                <Icon aria-hidden className={device.isActive ? 'size-5 text-primary' : 'size-5 text-muted-foreground'} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium">{device.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {device.isActive ? 'Playing here' : device.type}
                    {device.supportsVolume && device.volumePercent !== null && ` · ${device.volumePercent}% volume`}
                  </p>
                  {refusal && refusal.deviceId === device.id && <RefusalMessage device={device} error={refusal.error} />}
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
      ) : (
        <p className="text-sm text-muted-foreground">No devices have Spotify open. Open it on a phone, computer or speaker.</p>
      )}

      {before.length > 0 && (
        <section aria-labelledby="devices-before" className="flex flex-col gap-1">
          <p id="devices-before" className="text-xs font-medium text-muted-foreground">
            Played on before
          </p>
          <ul className="flex flex-col">
            {before.map((device) => {
              const Icon = ICONS[device.type] ?? MonitorSpeaker
              return (
                <li key={device.rememberedId} className="flex items-center gap-3 py-2">
                  <Icon aria-hidden className="size-5 text-muted-foreground" />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium">{device.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {device.type} · Last used {formatRelative(new Date(device.lastSeenAt))}
                    </p>
                    {refusal && refusal.deviceId === device.id && <RefusalMessage device={device} error={refusal.error} />}
                  </div>
                  {device.id && (
                    <Button size="sm" variant="ghost" onClick={() => onPlayHere(device.id!)} aria-label={`Try playing on ${device.name}`}>
                      Try here
                    </Button>
                  )}
                  <MenuRoot>
                    <MenuTrigger aria-label={`Options for ${device.name}`} className="size-8">
                      <MoreHorizontal aria-hidden className="size-4" />
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem onClick={() => onForget(device)}>
                        <Trash2 aria-hidden className="size-4 text-muted-foreground" /> Remove
                      </MenuItem>
                    </MenuContent>
                  </MenuRoot>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

/** Spotify can't reach a device that doesn't have it open, and says only "not found". */
function RefusalMessage({ device, error }: { device: Device; error: unknown }) {
  const unreachable = isApiError(error) && (error.code === 'not_found' || error.code === 'no_active_device')
  return (
    <p role="alert" className="text-xs text-destructive">
      {unreachable ? `Open Spotify on ${device.name} first.` : describeError(error).title}
    </p>
  )
}
