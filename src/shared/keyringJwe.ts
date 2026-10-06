/**
 * ipatool `file` keyring records are compact JWE (PBES2-HS256+A128KW + A256GCM).
 *
 * Only the DirectoryServicesID / e-mail / name are needed for matching a device
 * ApplicationDSID to a local account; the password field is never returned.
 */

import { createDecipheriv, pbkdf2Sync, createCipheriv, randomBytes } from 'node:crypto'

function b64urlToBuf(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function bufToB64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface KeyringIdentity {
  email: string
  dsid: string
  name: string
}

interface JweHeader {
  alg?: string
  enc?: string
  p2c?: number
  p2s?: string
}

/** RFC 3394 AES Key Wrap unwrap. */
export function aesKeyUnwrap(kek: Buffer, wrapped: Buffer): Buffer | null {
  if (kek.length !== 16) return null
  if (wrapped.length < 24 || wrapped.length % 8 !== 0) return null
  const n = wrapped.length / 8 - 1
  let A = Buffer.from(wrapped.subarray(0, 8))
  const R: Buffer[] = []
  for (let i = 1; i <= n; i += 1) {
    R.push(Buffer.from(wrapped.subarray(i * 8, i * 8 + 8)))
  }

  for (let j = 5; j >= 0; j -= 1) {
    for (let i = n; i >= 1; i -= 1) {
      const t = n * j + i
      const block = Buffer.alloc(8)
      block.writeUInt32BE(Math.floor(t / 0x100000000), 0)
      block.writeUInt32BE(t >>> 0, 4)

      const input = Buffer.alloc(16)
      for (let k = 0; k < 8; k += 1) input[k] = A[k]! ^ block[k]!
      R[i - 1]!.copy(input, 8)

      const decipher = createDecipheriv('aes-128-ecb', kek, Buffer.alloc(0))
      decipher.setAutoPadding(false)
      const out = Buffer.concat([decipher.update(input), decipher.final()])
      A = Buffer.from(out.subarray(0, 8))
      R[i - 1] = Buffer.from(out.subarray(8, 16))
    }
  }

  const iv = Buffer.from([0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6])
  return A.equals(iv) ? Buffer.concat(R) : null
}

/** RFC 3394 wrap (used by tests). */
export function aesKeyWrap(kek: Buffer, cek: Buffer): Buffer | null {
  if (kek.length !== 16 || cek.length % 8 !== 0 || cek.length < 16) return null
  const n = cek.length / 8
  let A = Buffer.from([0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6])
  const R: Buffer[] = []
  for (let i = 0; i < n; i += 1) R.push(Buffer.from(cek.subarray(i * 8, i * 8 + 8)))

  for (let j = 0; j <= 5; j += 1) {
    for (let i = 1; i <= n; i += 1) {
      const t = n * j + i
      const block = Buffer.alloc(8)
      block.writeUInt32BE(Math.floor(t / 0x100000000), 0)
      block.writeUInt32BE(t >>> 0, 4)
      const input = Buffer.alloc(16)
      A.copy(input, 0)
      R[i - 1]!.copy(input, 8)
      const cipher = createCipheriv('aes-128-ecb', kek, Buffer.alloc(0))
      cipher.setAutoPadding(false)
      const out = Buffer.concat([cipher.update(input), cipher.final()])
      A = Buffer.from(out.subarray(0, 8))
      for (let k = 0; k < 8; k += 1) A[k] = A[k]! ^ block[k]!
      R[i - 1] = Buffer.from(out.subarray(8, 16))
    }
  }
  return Buffer.concat([A, ...R])
}

/** Decrypts one compact JWE. Returns plaintext or null. */
export function decryptJwe(jwe: string, passphrase: string): string | null {
  const parts = jwe.trim().split('.')
  const head = parts[0]
  const encKeyB64 = parts[1]
  const ivB64 = parts[2]
  const ctB64 = parts[3]
  const tagB64 = parts[4]
  if (parts.length !== 5 || passphrase === '') return null
  if (!head || !encKeyB64 || !ivB64 || !ctB64 || !tagB64) return null

  let header: JweHeader
  try {
    header = JSON.parse(b64urlToBuf(head).toString('utf8')) as JweHeader
  } catch {
    return null
  }
  if (header.alg !== 'PBES2-HS256+A128KW' || header.enc !== 'A256GCM') return null
  const p2c = typeof header.p2c === 'number' && header.p2c > 0 ? header.p2c : 8192
  if (typeof header.p2s !== 'string') return null

  try {
    const encKey = b64urlToBuf(encKeyB64)
    const iv = b64urlToBuf(ivB64)
    const ciphertext = b64urlToBuf(ctB64)
    const tag = b64urlToBuf(tagB64)

    // RFC 7518 §4.8.1.2: salt = UTF8(alg) || 0x00 || p2s
    const salt = Buffer.concat([
      Buffer.from(header.alg, 'utf8'),
      Buffer.from([0]),
      b64urlToBuf(header.p2s)
    ])
    const kek = pbkdf2Sync(Buffer.from(passphrase, 'utf8'), salt, p2c, 16, 'sha256')
    const cek = aesKeyUnwrap(kek, encKey)
    if (!cek || cek.length !== 32) return null

    const decipher = createDecipheriv('aes-256-gcm', cek, iv)
    decipher.setAAD(Buffer.from(head, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** Encrypts plaintext the same way go-keyring file backend does (tests). */
export function encryptJwe(plaintext: string, passphrase: string, p2c = 8192): string {
  const p2s = randomBytes(8)
  const header: JweHeader = {
    alg: 'PBES2-HS256+A128KW',
    enc: 'A256GCM',
    p2c,
    p2s: bufToB64url(p2s)
  }
  const headerB64 = bufToB64url(Buffer.from(JSON.stringify(header), 'utf8'))
  const salt = Buffer.concat([Buffer.from('PBES2-HS256+A128KW', 'utf8'), Buffer.from([0]), p2s])
  const kek = pbkdf2Sync(Buffer.from(passphrase, 'utf8'), salt, p2c, 16, 'sha256')
  const cek = randomBytes(32)
  const wrapped = aesKeyWrap(kek, cek)
  if (!wrapped) throw new Error('wrap failed')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', cek, iv)
  cipher.setAAD(Buffer.from(headerB64, 'utf8'))
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  return [headerB64, bufToB64url(wrapped), bufToB64url(iv), bufToB64url(ct), bufToB64url(tag)].join('.')
}

/** Identity from a decrypted (or plain) account record. */
export function parseKeyringIdentity(raw: string): KeyringIdentity | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const str = (k: string): string => (typeof parsed[k] === 'string' ? (parsed[k] as string).trim() : '')
    const email = str('email')
    const dsid = str('directoryServicesIdentifier')
    const name = str('name')
    if (email === '' && dsid === '') return null
    return { email, dsid, name }
  } catch {
    return null
  }
}
