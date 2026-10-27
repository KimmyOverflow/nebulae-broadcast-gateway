// ============================================================
// ZLMediaKit Web Hook 接口 —— 请求参数类型声明
// 参考文档: https://docs.zlmediakit.com/zh/guide/media_server/web_hook_api.html
//
// 本文件中的代码是由AI完成的。
// ============================================================

/** 服务器 ID，通过配置文件设置 */
type MediaServerId = string;

/** 源 socket 信息 */
export interface OriginSocket {
    /** socket 标识 */
    identifier: string;
    /** 本机 IP */
    local_ip: string;
    /** 本机端口 */
    local_port: number;
    /** 对端 IP */
    peer_ip: string;
    /** 对端端口 */
    peer_port: number;
}

/** 产生源类型枚举 */
export enum OriginType {
    Unknown = 0,
    RtmpPush = 1,
    RtspPush = 2,
    RtpPush = 3,
    Pull = 4,
    FfmpegPull = 5,
    Mp4Vod = 6,
    DeviceChn = 7,
    RtcPush = 8,
}

/** 编码类型枚举 */
export enum CodecId {
    H264 = 0,
    H265 = 1,
    AAC = 2,
    G711A = 3,
    G711U = 4,
}

/** 轨道类型 */
export enum CodecType {
    /** 视频 */
    Video = 0,
    /** 音频 */
    Audio = 1,
}

/** 流协议类型 */
export type StreamSchema = 'fmp4' | 'ts' | 'rtmp' | 'rtsp' | 'hls'

/** 媒体轨道信息 */
interface MediaTrackBase {
    /** 编码类型 ID */
    codec_id: CodecId;
    /** 编码类型名称，如 CodecH264 / CodecAAC */
    codec_id_name: string;
    /** 轨道是否准备就绪 */
    ready: boolean;
}

export interface MediaTrackAudio extends MediaTrackBase {
    /** 轨道类型 */
    codec_type: CodecType.Audio;

    // ---- 音频特有字段 ----
    /** 音频通道数 */
    channels: number;
    /** 音频采样位数 */
    sample_bit: number;
    /** 音频采样率 */
    sample_rate: number;
}

export interface MediaTrackVideo extends MediaTrackBase {
    /** 轨道类型 */
    codec_type: CodecType.Video;

    // ---- 视频特有字段 ----
    /** 视频帧率 */
    fps: number;
    /** 视频高度 */
    height: number;
    /** 视频宽度 */
    width: number;
}

export type MediaTrack = MediaTrackAudio | MediaTrackVideo

/**
 * 各类型对象计数
 */
export interface ServerKeepaliveData {
    Buffer: number;
    BufferLikeString: number;
    BufferList: number;
    BufferRaw: number;
    Frame: number;
    FrameImp: number;
    MediaSource: number;
    MultiMediaSourceMuxer: number;
    RtmpPacket: number;
    RtpPacket: number;
    Socket: number;
    TcpClient: number;
    TcpServer: number;
    TcpSession: number;
    UdpServer: number;
    UdpSession: number;
}

export namespace WebhookMessage {
    export interface Base {
        hook_index: number
    }

    /**
     * on_play 请求参数
     * 播放器鉴权事件，rtsp/rtmp/http-flv/ws-flv/hls 的播放都将触发此鉴权事件
     */
    export interface OnPlay extends Base {
        /** 服务器 ID */
        mediaServerId: MediaServerId;
        /** 流应用名 */
        app: string;
        /** TCP 链接唯一 ID */
        id: string;
        /** 播放器 IP */
        ip: string;
        /** 播放 URL 参数 */
        params: string;
        /** 播放器端口号 */
        port: number;
        /** 播放的协议 (rtsp / rtmp / http) */
        schema: string;
        /** 流 ID */
        stream: string;
        /** 流虚拟主机 */
        vhost: string;
    }

    export namespace OnStreamChanged {
        /**
         * on_stream_changed 共有字段
         * rtsp/rtmp 流注册或注销时触发此事件
         */
        interface Base extends WebhookMessage.Base {
            /** 服务器 ID */
            mediaServerId: MediaServerId;
            /** 流应用名 */
            app: string;
            /** 协议 (rtsp / rtmp) */
            schema: StreamSchema;
            /** 流 ID */
            stream: string;
            /** 流虚拟主机 */
            vhost: string;
        }
        
        /** 流注册 */
        export interface Registered extends Base {
            regist: true;
            /** 存活时间，单位秒 */
            aliveSecond: number;
            /** 数据产生速度，单位 byte/s */
            bytesSpeed: number;
            /** GMT unix 系统时间戳，单位秒 */
            createStamp: number;
            /** 源 socket 信息 */
            originSock: OriginSocket;
            /** 产生源类型 */
            originType: OriginType;
            /** 产生源类型字符串 */
            originTypeStr: string;
            /** 产生源的 URL */
            originUrl: string;
            /** 本协议观看人数 */
            readerCount: number;
            /** 观看总人数（含 hls/rtsp/rtmp/http-flv/ws-flv/rtc） */
            totalReaderCount: number;
            /** 媒体轨道列表 */
            tracks: MediaTrack[];
        }

        /** 流注销 */
        export interface Deregistered extends Base {
            regist: false;
        }
    }



    /**
     * on_stream_changed 请求参数（可辨识联合类型）
     * 根据 regist 字段自动窄化：true → 注册, false → 注销
     */
    export type OnStreamChanged =
        | OnStreamChanged.Registered
        | OnStreamChanged.Deregistered;

    /**
     * on_flow_report 请求参数
     * 播放器或推流器断开时且耗用流量超过特定阈值时触发
     */
    export interface OnFlowReport extends Base {
        /** 服务器 ID */
        mediaServerId: MediaServerId;
        /** 流应用名 */
        app: string;
        /** TCP 链接维持时间，单位秒 */
        duration: number;
        /** 推流或播放 URL 参数 */
        params: string;
        /** true 为播放器，false 为推流器 */
        player: boolean;
        /** 播放或推流的协议 (rtsp / rtmp / http) */
        schema: string;
        /** 流 ID */
        stream: string;
        /** 耗费上下行流量总和，单位字节 */
        totalBytes: number;
        /** 流虚拟主机 */
        vhost: string;
        /** 客户端 IP */
        ip: string;
        /** 客户端端口号 */
        port: number;
        /** TCP 链接唯一 ID */
        id: string;
    }

    /**
     * on_server_started 请求参数
     * 服务器启动时触发，body 为整个配置文件的扁平化 JSON 对象
     *
     * 所有值均为字符串，键名为 `section.key` 格式。
     */
    export interface OnServerStarted extends Base {
        // ---- api ----
        "api.apiDebug"?: string;
        "api.secret": string;

        // ---- ffmpeg ----
        "ffmpeg.bin"?: string;
        "ffmpeg.cmd"?: string;
        "ffmpeg.log"?: string;

        // ---- general ----
        "general.mediaServerId": string;
        "general.addMuteAudio"?: string;
        "general.enableVhost"?: string;
        "general.flowThreshold"?: string;
        "general.maxStreamWaitMS"?: string;
        "general.publishToHls"?: string;
        "general.publishToMP4"?: string;
        "general.publishToRtxp"?: string;
        "general.resetWhenRePlay"?: string;
        "general.streamNoneReaderDelayMS"?: string;
        "general.ultraLowDelay"?: string;

        // ---- hls ----
        "hls.fileBufSize"?: string;
        "hls.filePath"?: string;
        "hls.segDur"?: string;
        "hls.segNum"?: string;
        "hls.segRetain"?: string;

        // ---- hook ----
        "hook.admin_params"?: string;
        "hook.enable"?: string;
        "hook.on_flow_report"?: string;
        "hook.on_http_access"?: string;
        "hook.on_play"?: string;
        "hook.on_publish"?: string;
        "hook.on_record_mp4"?: string;
        "hook.on_rtsp_auth"?: string;
        "hook.on_rtsp_realm"?: string;
        "hook.on_server_started"?: string;
        "hook.on_shell_login"?: string;
        "hook.on_stream_changed"?: string;
        "hook.on_stream_none_reader"?: string;
        "hook.on_stream_not_found"?: string;
        "hook.timeoutSec"?: string;

        // ---- http ----
        "http.charSet"?: string;
        "http.keepAliveSecond"?: string;
        "http.maxReqCount"?: string;
        "http.maxReqSize"?: string;
        "http.notFound"?: string;
        "http.port"?: string;
        "http.rootPath"?: string;
        "http.sendBufSize"?: string;
        "http.sslport"?: string;

        // ---- multicast ----
        "multicast.addrMax"?: string;
        "multicast.addrMin"?: string;
        "multicast.udpTTL"?: string;

        // ---- record ----
        "record.appName"?: string;
        "record.fastStart"?: string;
        "record.fileBufSize"?: string;
        "record.filePath"?: string;
        "record.fileRepeat"?: string;
        "record.fileSecond"?: string;
        "record.sampleMS"?: string;

        // ---- rtc ----
        "rtc.bfilter"?: string
        "rtc.datachannel_echo"?: string
        "rtc.enableTurn"?: string
        "rtc.externIP"?: string
        "rtc.icePort"?: string
        "rtc.icePwd"?: string
        "rtc.iceTcpPort"?: string
        "rtc.iceTransportPolicy"?: string
        "rtc.iceUfrag"?: string
        "rtc.interfaces"?: string
        "rtc.maxRtpCacheMS"?: string
        "rtc.maxRtpCacheSize"?: string
        "rtc.max_bitrate"?: string
        "rtc.max_stun_retry"?: string
        "rtc.min_bitrate"?: string
        "rtc.nackAudioRtpSize"?: string
        "rtc.nackIntervalRatio"?: string
        "rtc.nackMaxCount"?: string
        "rtc.nackMaxMS"?: string
        "rtc.nackMaxSize"?: string
        "rtc.nackRtpSize"?: string
        "rtc.port"?: string
        "rtc.port_range"?: string
        "rtc.preferredCodecA"?: string
        "rtc.preferredCodecV"?: string
        "rtc.preferred_tcp"?: string
        "rtc.rembBitRate"?: string
        "rtc.signalingPort"?: string
        "rtc.signalingSslPort"?: string
        "rtc.start_bitrate"?: string
        "rtc.tcpPort"?: string
        "rtc.timeoutSec"?: string

        // ---- rtmp ----
        "rtmp.handshakeSecond"?: string;
        "rtmp.keepAliveSecond"?: string;
        "rtmp.modifyStamp"?: string;
        "rtmp.port"?: string;

        // ---- rtp ----
        "rtp.audioMtuSize"?: string;
        "rtp.clearCount"?: string;
        "rtp.cycleMS"?: string;
        "rtp.maxRtpCount"?: string;
        "rtp.videoMtuSize"?: string;

        // ---- rtsp ----
        "rtsp.authBasic"?: string;
        "rtsp.directProxy"?: string;
        "rtsp.handshakeSecond"?: string;
        "rtsp.keepAliveSecond"?: string;
        "rtsp.modifyStamp"?: string;
        "rtsp.port"?: string;
        "rtsp.sslport"?: string;

        // ---- shell ----
        "shell.maxReqSize"?: string;
        "shell.port"?: string;
    }

    /**
     * on_server_keepalive 请求参数
     * 服务器定时上报事件，上报间隔可配置，默认 10s 上报一次
     */
    export interface OnServerKeepalive extends Base {
        /** 各类型对象计数 */
        data: ServerKeepaliveData;
        /** 服务器 ID */
        mediaServerId: MediaServerId;
    }

    export interface OnPublish extends Base {
        mediaServerId: string
        app: string
        id: string
        ip: string
        params: string
        port: number
        schema: string
        stream: string
        vhost: string
    }
}
