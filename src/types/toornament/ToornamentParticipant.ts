export interface ToornamentParticipant {
    id: string;
    name: string;
    custom_user_identifier: string | null;
    custom_fields: Record<string, any>;
}