import * as ExpoFSLegacy from 'expo-file-system/legacy'
import type { ImagePickerAsset } from 'expo-image-picker'
import { Platform } from 'react-native'

import { supabase } from '@/supabase'

export const COURT_PHOTOS_BUCKET = 'court-photos'

/** Path inside bucket `court-photos` from a Storage public object URL. */
export function objectPathFromCourtPhotosPublicUrl(photoUrl: string): string | null {
  const needle = `/storage/v1/object/public/${COURT_PHOTOS_BUCKET}/`
  const i = photoUrl.indexOf(needle)
  if (i === -1) return null
  let path = photoUrl.slice(i + needle.length)
  const q = path.indexOf('?')
  if (q !== -1) path = path.slice(0, q)
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const bin = globalThis.atob(base64)
  const len = bin.length
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function imageContentType(asset: ImagePickerAsset, ext: string): string {
  if (asset.mimeType) return asset.mimeType
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'heic':
    case 'heif':
      return 'image/heic'
    default:
      return 'image/jpeg'
  }
}

function fileExtensionFromAsset(asset: ImagePickerAsset): string {
  let ext =
    asset.fileName?.split('.').pop()?.toLowerCase()?.replace(/^\./, '')
    ?? asset.mimeType?.split('/')[1]
    ?? 'jpg'
  if (ext.includes('jpeg')) ext = 'jpg'
  return ext
}

/** Reads picked/captured photo bytes reliably on native (avoid fetch+blob empty bodies on RN). */
export async function uriImageBytes(uri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    const r = await fetch(uri)
    if (!r.ok) throw new Error(`Could not read image (${r.status})`)
    const buf = await r.arrayBuffer()
    return new Uint8Array(buf)
  }
  const b64 = await ExpoFSLegacy.readAsStringAsync(uri, { encoding: ExpoFSLegacy.EncodingType.Base64 })
  return base64ToUint8Array(b64)
}

/**
 * Uploads a picked image to `court-photos` under `{userId}/{subpath}.{ext}`.
 * Court photos pass subpath like `{courtId}/{timestamp}`; avatars pass `avatars/{timestamp}`.
 */
export async function uploadPickedImageToCourtPhotos(
  userId: string,
  asset: ImagePickerAsset,
  subpath: string,
): Promise<{ publicUrl: string } | { error: Error }> {
  const ext = fileExtensionFromAsset(asset)
  const objectPath = `${userId}/${subpath}.${ext}`

  try {
    const bytes = await uriImageBytes(asset.uri)
    if (bytes.byteLength === 0) {
      return { error: new Error('That photo did not load. Try choosing another picture.') }
    }

    const contentType = imageContentType(asset, ext)
    const { error: uploadError } = await supabase.storage
      .from(COURT_PHOTOS_BUCKET)
      .upload(objectPath, bytes, { contentType, upsert: false })

    if (uploadError) {
      return { error: uploadError }
    }

    const { data: pub } = supabase.storage.from(COURT_PHOTOS_BUCKET).getPublicUrl(objectPath)
    return { publicUrl: pub.publicUrl }
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)) }
  }
}

/** Removes a storage object when `publicUrl` points at our `court-photos` bucket. */
export async function removeCourtPhotosObjectByPublicUrl(publicUrl: string): Promise<void> {
  const objectPath = objectPathFromCourtPhotosPublicUrl(publicUrl)
  if (!objectPath) return
  const { error } = await supabase.storage.from(COURT_PHOTOS_BUCKET).remove([objectPath])
  if (error && __DEV__) {
    console.warn('[storageImages] remove', objectPath, error.message)
  }
}
