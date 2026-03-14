export interface TeamData {
    id?: number | string,
    name: string,
    tag: string,
    flag: string,
    logo: string | null,
    matchtext?: string | null | undefined,
    public_team?: number,
    user_id?: number,
    ts_server?: string | null,
    ts_channel_id?: number | null,
    [key: string]: any
}