import { ToornamentMatchSettings } from "./ToornamentMatchSettings"
import { ToornamentOpponent } from "./ToornamentOpponent"

export interface ToornamentMatch {
    tournament_id: string;
    id: string;
    stage_id: string;
    group_id: string;
    round_id: string;
    number: number;
    type: "duel" | "ffa";
    status: "pending" | "running" | "completed";
    report_status: string | null;
    settings: ToornamentMatchSettings;
    scheduled_datetime: string | null;
    played_at: string | null;
    public_note: string | null;
    participant_note: string | null;
    private_note: string | null;
    report_closed: boolean;
    opponents: ToornamentOpponent[];
}