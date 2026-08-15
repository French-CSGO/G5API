import { Get5_ConnectionPlayerInfo } from "./Get5_ConnectionPlayerInfo"

export interface Get5_OnPlayerDisconnect {
  event: string
  matchid: string
  player: Get5_ConnectionPlayerInfo
}
