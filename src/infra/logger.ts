import chalk from "chalk"
import { existsSync, mkdirSync, openSync, writeSync } from "fs"
import { LOG_PATH } from "../consts"

export enum LogLevel {
    Info,
    Warn,
    Error,
    Fatal
}

export type LogEntry = {
    /** Unix Timestamp in milliseconds. */
    timestamp?: number,
    level: LogLevel,
    prefix: string,
    content: string,
    stack?: string | null,
    additionalContent?: string | null
}

export interface LoggerTransport {
    level: LogLevel[],
    format: (entry: Required<LogEntry>) => string,
    write: (string: string) => void
}

interface LoggerConfig {
    verbose: boolean
}

export class AppLogger {
    private transports: LoggerTransport[]
    private config: LoggerConfig
    constructor(config: LoggerConfig) {
        this.config = config
        this.transports = [
            {
                level: [LogLevel.Info],
                format: (entry) => {
                    return `${chalk.white(`${new Date(entry.timestamp).toLocaleString()} - INFO - ${entry.prefix} | `)}${chalk.white.bold(entry.content)}${entry.additionalContent !== null ? `\n${chalk.white.dim(entry.additionalContent)}` : ''}`
                },
                write: (string) => {
                    console.log(string)
                }
            },
            {
                level: [LogLevel.Warn],
                format: (entry) => {
                    return `${chalk.yellow(`${new Date(entry.timestamp).toLocaleString()} - WARN - ${entry.prefix} | `)}${chalk.yellow.bold(entry.content)}${entry.additionalContent !== null ? `\n${chalk.yellow.dim(entry.additionalContent)}` : ''}`
                },
                write: (string) => {
                    console.warn(string)
                }
            },
            {
                level: [LogLevel.Error, LogLevel.Fatal],
                format: (entry) => {
                    return `${chalk.red(`${new Date(entry.timestamp).toLocaleString()} - ${entry.level === LogLevel.Error ? 'ERROR' : 'FATAL'} - ${entry.prefix} | `)}${chalk.red.bold(entry.content)}${entry.additionalContent !== null ? `\n${chalk.red.dim(entry.additionalContent)}` : ''}`
                },
                write: (string) => {
                    console.error(string)
                }
            },
            new FileTransport()
        ]
    }

    public log(entry: LogEntry) {
        if (this.config.verbose === false) {
            entry.additionalContent = null
        }
        entry.timestamp ??= Date.now()
        entry.additionalContent ??= null
        this.transports.forEach(transport => {
            if (transport.level.find(level => level === entry.level) !== undefined) {
                transport.write(transport.format(entry as Required<LogEntry>))
            }
        })
    }
}

class FileTransport implements LoggerTransport {
    public level = [LogLevel.Info, LogLevel.Warn, LogLevel.Error, LogLevel.Fatal]
    private fileDescriptor: number
    private fileName: string
    constructor() {
        if (!existsSync(LOG_PATH)) {
            mkdirSync(LOG_PATH, { recursive: true })
        }
        this.fileName = this.getCurrentDateTimeString()
        this.fileDescriptor = openSync(`./logs/${this.fileName}`, 'w')
    }
    public format(entry: Required<LogEntry>): string {
        let level = ['INFO', 'WARN', 'ERROR', 'FATAL'][entry.level]!
        return `${new Date(entry.timestamp).toLocaleString()} - ${level} - ${entry.prefix} | ${entry.content}\n`
    }
    public write(string: string) {
        writeSync(this.fileDescriptor, string)
    }
    private getCurrentDateTimeString(): string {
        const d = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
    }
}
