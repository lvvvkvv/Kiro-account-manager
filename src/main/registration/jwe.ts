import crypto from 'crypto'
import { newUUID } from './http-utils'

function b64url(data: Buffer): string {
  return data.toString('base64url')
}

function jwkToPublicKey(jwk: Record<string, string>): crypto.KeyObject {
  return crypto.createPublicKey({
    key: {
      kty: 'RSA',
      n: jwk.n,
      e: jwk.e
    },
    format: 'jwk'
  })
}

/** JWE 加密密码 (RSA-OAEP-256 + A256GCM) */
export function encryptPassword(
  password: string,
  publicKey: Record<string, string>,
  issuer: string,
  audience: string,
  region: string
): string {
  // Header
  const header = {
    alg: 'RSA-OAEP-256',
    kid: publicKey.kid,
    enc: 'A256GCM',
    cty: 'enc',
    typ: 'application/aws+signin+jwe'
  }
  const headerJSON = Buffer.from(JSON.stringify(header))
  const headerB64 = b64url(headerJSON)

  // CEK (内容加密密钥)
  const cek = crypto.randomBytes(32)

  // RSA-OAEP-256 加密 CEK
  const pubKey = jwkToPublicKey(publicKey)
  const encryptedCEK = crypto.publicEncrypt(
    {
      key: pubKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    },
    cek
  )

  // Claims
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: `${region}.${issuer}`,
    iat: now,
    nbf: now,
    jti: newUUID(),
    exp: now + 300,
    aud: `${region}.${audience}`,
    password
  }
  const plaintext = Buffer.from(JSON.stringify(claims))

  // AES-256-GCM 加密
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', cek, iv, { authTagLength: 16 })
  cipher.setAAD(Buffer.from(headerB64, 'ascii'))
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  // JWE Compact: header.encKey.iv.ciphertext.tag
  return `${headerB64}.${b64url(encryptedCEK)}.${b64url(iv)}.${b64url(ct)}.${b64url(tag)}`
}
