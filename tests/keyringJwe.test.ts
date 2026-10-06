import { describe, expect, it } from 'vitest'
import { aesKeyUnwrap, aesKeyWrap, decryptJwe, encryptJwe, parseKeyringIdentity } from '@shared/keyringJwe'

describe('aes key wrap', () => {
  it('round-trips a 256-bit CEK', () => {
    const kek = Buffer.alloc(16, 7)
    const cek = Buffer.alloc(32, 9)
    const wrapped = aesKeyWrap(kek, cek)
    expect(wrapped).not.toBeNull()
    expect(aesKeyUnwrap(kek, wrapped as Buffer)?.equals(cek)).toBe(true)
  })

  it('rejects a tampered wrapped key', () => {
    const kek = Buffer.alloc(16, 7)
    const wrapped = aesKeyWrap(kek, Buffer.alloc(32, 9)) as Buffer
    wrapped[10] = (wrapped[10] ?? 0) ^ 0xff
    expect(aesKeyUnwrap(kek, wrapped)).toBeNull()
  })
})

describe('decryptJwe / encryptJwe', () => {
  it('round-trips a go-keyring-shaped JWE', () => {
    const pass = 'unit-test-passphrase'
    const payload = JSON.stringify({
      email: 'jane@example.com',
      name: 'Jane',
      directoryServicesIdentifier: '20825825307',
      passwordToken: 'x',
      password: 'secret'
    })
    const jwe = encryptJwe(payload, pass, 1024)
    const plain = decryptJwe(jwe, pass)
    expect(plain).not.toBeNull()
    const id = parseKeyringIdentity(plain as string)
    expect(id?.dsid).toBe('20825825307')
    expect(id?.email).toBe('jane@example.com')
  })

  it('fails closed on a wrong passphrase', () => {
    const jwe = encryptJwe('{"email":"a@b.c","directoryServicesIdentifier":"1"}', 'right', 1024)
    expect(decryptJwe(jwe, 'wrong')).toBeNull()
    expect(decryptJwe('not-a-jwe', 'right')).toBeNull()
  })
})

describe('parseKeyringIdentity', () => {
  it('needs an email or DSID', () => {
    expect(parseKeyringIdentity('{"name":"x"}')).toBeNull()
    expect(parseKeyringIdentity('{"directoryServicesIdentifier":"42"}')?.dsid).toBe('42')
  })
})
