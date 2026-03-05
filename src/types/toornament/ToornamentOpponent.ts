import { ToornamentParticipant } from "./ToornamentParticipant"

export interface ToornamentOpponent {
    number: number;
    position: number;
    participant: ToornamentParticipant | null;
    rank: number | null;
    result: "win" | "loss" | "draw" | null;
    forfeit: boolean;
    score: number | null;
}