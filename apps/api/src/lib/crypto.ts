// Web Crypto only, so this also runs on Vercel/edge runtimes.

const FORMAT = 'v1'

export type TokenCipher = {
  encrypt(plaintext: string): Promise<string>
  decrypt(payload: string): Promise<string>
}

/** AES-256-GCM with a random 96-bit IV per value. Output: `v1.<iv>.<ciphertext+tag>` (base64url). */
export async function createTokenCipher(base64Key: string): Promise<TokenCipher> {
  const raw = fromBase64(base64Key)
  if (raw.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded. Generate one with: openssl rand -base64 32')
  }
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

  return {
    async encrypt(plaintext) {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
      return [FORMAT, toBase64Url(iv), toBase64Url(new Uint8Array(ciphertext))].join('.')
    },
    async decrypt(payload) {
      const [format, iv, ciphertext] = payload.split('.')
      if (format !== FORMAT || !iv || !ciphertext) throw new Error('Unrecognised encrypted token format')
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64Url(iv) },
        key,
        fromBase64Url(ciphertext),
      )
      return new TextDecoder().decode(plaintext)
    },
  }
}

/** 256-bit random session token for the client. Only its hash is stored. */
export function createSessionToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Web-standard base64 helpers (no Buffer), so this file also type-checks in browser
// packages that import the API's types.
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

function toBase64Url(data: Uint8Array): string {
  let binary = ''
  for (const byte of data) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  return fromBase64(value.replace(/-/g, '+').replace(/_/g, '/'))
}
