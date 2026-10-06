import { memo, useEffect } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useArtworkStore } from '@renderer/store/artwork'
import { useAppStore } from '@renderer/store/app'

/** Deterministic pastel-ish hue so a monogram is stable per app. */
function hueFor(seed: string | number): number {
  const text = String(seed)
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 360
}

export interface AppIconProps {
  appId: number
  name: string
  /** Fallback artwork key when there is no App Store id (device list). */
  bundleID?: string
  size?: number
  radius?: number
}

/**
 * App artwork with a generated monogram fallback.
 *
 * Artwork is requested on mount, which - because rows are virtualised - means we
 * only ever fetch icons for what is actually visible. Failures fall back to a
 * deterministic monogram rather than a broken-image glyph.
 */
export const AppIcon = memo(function AppIcon({
  appId,
  name,
  bundleID,
  size = 36,
  radius = 9
}: AppIconProps): ReactNode {
  const byId = useArtworkStore((state) => state.byId)
  const request = useArtworkStore((state) => state.request)
  const requestByBundle = useArtworkStore((state) => state.requestByBundle)
  const enabled = useAppStore((state) => state.settings.artworkEnabled)

  const key = appId > 0 ? `id:${appId}` : bundleID ? `bundle:${bundleID}` : ''
  const artwork = key ? (byId[key] ?? undefined) : undefined

  useEffect(() => {
    if (!enabled) return
    if (appId > 0) request(appId)
    else if (bundleID) requestByBundle(bundleID)
  }, [appId, bundleID, enabled, request, requestByBundle])

  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0
  }

  const initial = (name.trim()[0] ?? '?').toUpperCase()

  if (enabled && artwork) {
    return (
      <img
        src={artwork}
        alt=""
        width={size}
        height={size}
        style={{ ...style, objectFit: 'cover', background: 'var(--panel-2)' }}
        loading="lazy"
        decoding="async"
      />
    )
  }

  const hue = hueFor(appId || bundleID || name)
  return (
    <div
      aria-hidden="true"
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(150deg, hsl(${hue} 62% 62%), hsl(${(hue + 40) % 360} 58% 48%))`,
        color: '#fff',
        fontSize: Math.round(size * 0.44),
        fontWeight: 650,
        letterSpacing: '-0.02em',
        userSelect: 'none'
      }}
    >
      {initial}
    </div>
  )
})
