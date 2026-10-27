import 'express-session';

declare module 'express-session' {
    interface SessionData {
        isLoggedIn: boolean
        userId: number,
        refreshTokenId: number,
        role: 'user' | 'admin'
    }
}
