import { describe, expect, it } from 'vitest'
import { createSessionToken, createTokenCipher, hashSessionToken } from './crypto.ts'

const key = Buffer.alloc(32, 1).toString('base64')

describe('createTokenCipher', () => {
  it('round-trips and never returns the plaintext', async () => {
    const cipher = await createTokenCipher(key)
    const encrypted = await cipher.encrypt('spotify-refresh-token')
    expect(encrypted).toMatch(/^v1\.[\w-]+\.[\w-]+$/)
    expect(encrypted).not.toContain('spotify-refresh-token')
    await expect(cipher.decrypt(encrypted)).resolves.toBe('spotify-refresh-token')
  })

  it('uses a fresh IV for every value', async () => {
    const cipher = await createTokenCipher(key)
    expect(await cipher.encrypt('same')).not.toBe(await cipher.encrypt('same'))
  })

  it('rejects tampered ciphertext and the wrong key', async () => {
    const cipher = await createTokenCipher(key)
    const [format, iv, ciphertext] = (await cipher.encrypt('secret')).split('.')
    const tampered = [format, iv, `${ciphertext!.slice(0, -2)}AA`].join('.')
    await expect(cipher.decrypt(tampered)).rejects.toBeInstanceOf(Error)

    const other = await createTokenCipher(Buffer.alloc(32, 2).toString('base64'))
    await expect(other.decrypt(await cipher.encrypt('secret'))).rejects.toBeInstanceOf(Error)
  })

  it('requires a 32-byte key', async () => {
    await expect(createTokenCipher(Buffer.alloc(16).toString('base64'))).rejects.toThrow(/32 bytes/)
  })
})

describe('session tokens', () => {
  it('are random and hash deterministically', async () => {
    const token = createSessionToken()
    expect(token).toMatch(/^[\w-]{43}$/)
    expect(createSessionToken()).not.toBe(token)
    expect(await hashSessionToken(token)).toBe(await hashSessionToken(token))
    expect(await hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/)
  })
})
