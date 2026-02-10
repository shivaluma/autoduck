/**
 * Cloudflare R2 Video Upload
 * Uses AWS S3 SDK (S3-compatible API)
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import * as fs from 'fs'
import * as path from 'path'

// R2 Configuration from environment
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'autoduck-videos'
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '' // e.g., https://videos.yourdomain.com

// Initialize S3 client for R2
const r2Client = new S3Client({
  region: 'auto',
  endpoint: R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
})

/**
 * Check if R2 is configured
 */
export function isR2Configured(): boolean {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)
}

/**
 * Upload a video file to R2
 * @param filePath - Local path to the video file
 * @param raceId - Race ID for generating the filename
 * @returns Public URL of the uploaded video, or null if R2 is not configured
 */
export async function uploadVideoToR2(
  filePath: string,
  raceId: number
): Promise<string | null> {
  if (!isR2Configured()) {
    console.warn('⚠️ R2 not configured, skipping video upload')
    return null
  }

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Video file not found: ${filePath}`)
    return null
  }

  try {
    // Generate unique filename
    const timestamp = Date.now()
    const ext = path.extname(filePath) || '.webm'
    const key = `races/race-${raceId}-${timestamp}${ext}`

    // Read the file
    const fileBuffer = fs.readFileSync(filePath)

    console.log(`📤 Uploading video to R2: ${key}`)

    // Upload to R2
    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: fileBuffer,
        ContentType: getContentType(ext),
      })
    )

    console.log(`✅ Video uploaded successfully: ${key}`)

    // Return public URL
    const publicUrl = R2_PUBLIC_URL
      ? `${R2_PUBLIC_URL}/${key}`
      : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`

    return publicUrl
  } catch (error) {
    console.error('❌ R2 upload failed:', error)
    return null
  }
}

/**
 * Upload a buffer to R2
 */
export async function uploadBufferToR2(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string | null> {
  if (!isR2Configured()) {
    console.warn('⚠️ R2 not configured, skipping upload')
    return null
  }

  try {
    console.log(`📤 Uploading to R2: ${key}`)

    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    )

    console.log(`✅ Uploaded successfully: ${key}`)

    const publicUrl = R2_PUBLIC_URL
      ? `${R2_PUBLIC_URL}/${key}`
      : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`

    return publicUrl
  } catch (error) {
    console.error('❌ R2 upload failed:', error)
    return null
  }
}

/**
 * Upload a video buffer directly to R2 (no file needed)
 * Wrapper for backward compatibility or convenience
 */
export async function uploadVideoBufferToR2(
  buffer: Buffer,
  raceId: number,
  ext: string = '.webm'
): Promise<string | null> {
  const timestamp = Date.now()
  const key = `races/race-${raceId}-${timestamp}${ext}`
  return uploadBufferToR2(buffer, key, getContentType(ext))
}

/**
 * Check if a file exists in R2
 */
export async function checkR2FileExists(key: string): Promise<boolean> {
  if (!isR2Configured()) return false

  try {
    await r2Client.send(
      new HeadObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
      })
    )
    return true
  } catch {
    return false
  }
}

/**
 * Get content type for video files
 */
function getContentType(ext: string): string {
  const types: Record<string, string> = {
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  }
  return types[ext.toLowerCase()] || 'application/octet-stream'
}
