import { number, object, string } from "zod"

export const SetStreamTokenAliasSchema = object({
    token_id: number(),
    alias: string()
})

export const SetRefreshTokenAliasSchema = object({
    token_id: number(),
    alias: string()
})

export const DeleteRefreshTokenSchema = object({
    token_id: number()
})

export const GenerateStreamTokenSchema = object({
    alias: string()
})

export const DeleteStreamTokenSchema = object({
    token_id: number()
})

export const ResetTotpSchema = object({
    user_id: number()
})

export const VerifyUserSchema = object({
    user_id: number()
})
