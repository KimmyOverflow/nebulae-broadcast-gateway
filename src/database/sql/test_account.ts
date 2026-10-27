import type { AppCrypto } from "../../infra/crypto";
import { assembleOtpauthUrl } from "../../server/routers/api/auth";
import type { AppDatabaseSql } from ".";

export async function prepareTestAccount(databaseSql: AppDatabaseSql, crypto: AppCrypto) {
    const passcode = "1225"
    const totpSecret = crypto.generateTotpSecret()
    const totpSecretEncrypted = crypto.aes256Encrypt(totpSecret)
    const passcodeHash = await crypto.bcryptHash(passcode)
    const userId = databaseSql.insertUser("dess", totpSecretEncrypted, passcodeHash)!
    databaseSql.setUserVerified(userId)
    console.log(assembleOtpauthUrl("dess", totpSecret))
}
