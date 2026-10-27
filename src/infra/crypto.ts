import { execSync } from "child_process"
import { randomBytes, createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from "crypto"
import { existsSync, mkdirSync, readFileSync } from "fs"
import { MASTER_KEY_PATH, SALT_ROUNDS, TOTP_TOKEN_VALIDATION_TIME_WINDOW } from "../consts"
import { dirname } from "path"
import { compare, hash } from "bcrypt"
import { TOTP } from "otpauth"
import { encode } from "hi-base32"

export class AppCrypto {
    private readonly key: Buffer

    get masterKey() {
        return this.key.toString('base64')
    }

    constructor() {
        if (!existsSync(MASTER_KEY_PATH)) {
            this.createMasterKey()
        }
        const encrypted = readFileSync(MASTER_KEY_PATH)
        this.key = this.decryptMasterKey(encrypted)
    }

    private createMasterKey() {
        mkdirSync(dirname(MASTER_KEY_PATH), { recursive: true })
        const psScript = `
            [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
            $ProgressPreference = 'SilentlyContinue'
            Add-Type -AssemblyName System.Security
            $plainKey = [byte[]]::new(32)
            $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            $rng.GetBytes($plainKey)
            $encryptedKey = [System.Security.Cryptography.ProtectedData]::Protect(
                $plainKey,
                $null,
                [System.Security.Cryptography.DataProtectionScope]::CurrentUser
            )
            $encryptedKey | Set-Content -Path "${MASTER_KEY_PATH}" -Encoding Byte
            Write-Output "Master key encrypted and saved."
        `
        try {
            console.log(execSync(`powershell -OutputFormat Text -EncodedCommand "${Buffer.from(psScript, 'utf-16le').toString('base64')}"`).toString())
        } catch (err) {
            // TODO: Throw fatal error here.
        }
    }

    /** Use Windows DPAPI to decrypt master key from encrypted data. */

    private decryptMasterKey(encrypted: Buffer): Buffer {
        const psScript = `
            [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
            $ProgressPreference = 'SilentlyContinue'
            Add-Type -AssemblyName System.Security
            $encryptedBytes = [System.Convert]::FromBase64String('${encrypted.toString('base64')}')
            $decryptedBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
                $encryptedBytes,
                $null,
                [System.Security.Cryptography.DataProtectionScope]::CurrentUser
            )
            [System.Convert]::ToBase64String($decryptedBytes)
        `
        const output = execSync(`powershell -OutputFormat Text -EncodedCommand "${Buffer.from(psScript, 'utf-16le').toString('base64')}"`).toString().trim()
        return Buffer.from(output, 'base64')
    }

    public aes256Encrypt(data: string): string {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', this.key, iv)
        const encrypted = Buffer.concat([
            cipher.update(data, 'utf-8'),
            cipher.final()
        ])
        const authTag = cipher.getAuthTag()
        return Buffer.concat([iv, authTag, encrypted]).toString('base64url')
    }

    public aes256Decrypt(data: string) {
        const blob = Uint8Array.from(Buffer.from(data, 'base64url'))
        const iv = blob.slice(0, 12)
        const authTag = blob.slice(12, 28)
        const ciphertext = blob.slice(28)

        const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
        decipher.setAuthTag(authTag)
        const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
        ])

        return decrypted.toString('utf-8')
    }

    public bcryptHash(data: string | Buffer) {
        return hash(data, SALT_ROUNDS)
    }

    public bcryptCompare(data: string | Buffer, encrypted: string) {
        return compare(data, encrypted)
    }

    public sha256Hash(data: string | Buffer) {
        return createHash('sha256').update(data).digest('base64url')
    }

    public validateTotpToken(token: string, totpSecret: string) {
        const totp = new TOTP({ secret: totpSecret })
        return totp.validate({ token, window: TOTP_TOKEN_VALIDATION_TIME_WINDOW })
    }

    public hmacSign(data: string) {
        return createHmac('sha256', this.key).update(data).digest('base64url')
    }

    public hmacVerify(data: string, signature: string) {
        const expected = Buffer.from(this.hmacSign(data))
        const actual = Buffer.from(signature)
        if (expected.length !== actual.length) return false
        return timingSafeEqual(expected, actual)
    }

    /** 生成带 HMAC 签名的结构化刷新令牌，内嵌用户 ID 用于泄露追溯. */
    public generateRefreshToken(userId: number, maxAge: number) {
        const rnd = randomBytes(32).toString('base64url')
        const exp = Date.now() + maxAge
        const payload = JSON.stringify({ uid: userId, rnd, exp })
        const payloadEncoded = Buffer.from(payload).toString('base64url')
        const signature = this.hmacSign(payloadEncoded)
        return payloadEncoded + '.' + signature
    }

    /** 验证刷新令牌的 HMAC 签名并提取用户 ID。返回 null 表示签名无效或格式错误. */
    public parseRefreshToken(token: string) {
        const dotIndex = token.indexOf('.')
        if (dotIndex === -1) return null

        const payloadEncoded = token.substring(0, dotIndex)
        const signature = token.substring(dotIndex + 1)

        if (!this.hmacVerify(payloadEncoded, signature)) return null

        let payload: any
        try {
            payload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf-8'))
        } catch {
            return null
        }

        if (typeof payload.uid !== 'number' || typeof payload.rnd !== 'string' || typeof payload.exp !== 'number') {
            return null
        }

        return {
            userId: payload.uid as number,
            rnd: payload.rnd as string,
            exp: payload.exp as number
        }
    }

    public generateStreamToken() {
        return randomBytes(32).toString('base64url')
    }

    public generateTotpSecret() {
        return encode(randomBytes(32))
    }
}
